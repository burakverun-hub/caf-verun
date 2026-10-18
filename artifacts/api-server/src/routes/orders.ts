import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateOrderBody,
  CreateOrderResponse,
  GetDashboardSummaryResponse,
  GetOrderParams,
  GetOrderResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdateOrderStatusResponse,
} from "@workspace/api-zod";
import {
  appUsersTable,
  branchInventoryTable,
  branchMenuItemsTable,
  branchesTable,
  db,
  ingredientsTable,
  inventoryTransactionsTable,
  menuItemsTable,
  orderItemsTable,
  ordersTable,
  orderStatusEnum,
  recipeIngredientsTable,
} from "@workspace/db";
import { getCafeUser, requireCafeUser } from "../middlewares/cafeAuth";

const router: IRouter = Router();
type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

class OrderConflictError extends Error {}

const nextStatus: Record<OrderStatus, OrderStatus | null> = {
  pending: "preparing",
  preparing: "ready",
  ready: "completed",
  completed: null,
};

function orderNumber(id: number): string {
  return `CV-${String(id).padStart(4, "0")}`;
}

function orderScope(user: ReturnType<typeof getCafeUser>) {
  if (user.role === "admin") return undefined;
  if (user.role === "customer") return eq(ordersTable.customerUserId, user.id);
  if (user.branchId !== null) return eq(ordersTable.branchId, user.branchId);
  return sql`false`;
}

async function serializeOrder(
  order: typeof ordersTable.$inferSelect,
  items: (typeof orderItemsTable.$inferSelect)[],
  branchName: string | null,
  kitchenInstructionsByItem?: Map<number, string>,
) {
  return {
    id: order.id,
    orderNumber: orderNumber(order.id),
    branchId: order.branchId,
    branchName,
    customerName: order.customerName,
    source: order.source,
    status: order.status,
    note: order.note,
    items: items.map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number((Number(item.unitPrice) * item.quantity).toFixed(2)),
      ...(kitchenInstructionsByItem?.has(item.menuItemId)
        ? { kitchenInstructions: kitchenInstructionsByItem.get(item.menuItemId) }
        : {}),
    })),
    total: Number(order.total),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

async function orderWithItems(
  order: typeof ordersTable.$inferSelect,
  includeKitchenInstructions: boolean,
) {
  const [items, branch] = await Promise.all([
    db
      .select()
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, order.id))
      .orderBy(orderItemsTable.id),
    order.branchId
      ? db
          .select({ name: branchesTable.name })
          .from(branchesTable)
          .where(eq(branchesTable.id, order.branchId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const instructions = new Map<number, string>();
  if (includeKitchenInstructions && items.length) {
    const menuItemIds = [...new Set(items.map((item) => item.menuItemId))];
    const menuItems = await db
      .select({ id: menuItemsTable.id, instructions: menuItemsTable.kitchenInstructions })
      .from(menuItemsTable)
      .where(inArray(menuItemsTable.id, menuItemIds));
    for (const item of menuItems) instructions.set(item.id, item.instructions);
  }
  return serializeOrder(order, items, branch[0]?.name ?? null, instructions);
}

async function listOrders(
  user: ReturnType<typeof getCafeUser>,
  status?: OrderStatus,
  limit = 100,
) {
  const clauses = [];
  const scope = orderScope(user);
  if (scope) clauses.push(scope);
  if (status) clauses.push(eq(ordersTable.status, status));
  const orders = await db
    .select()
    .from(ordersTable)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit);
  const result = await Promise.all(
    orders.map((order) => orderWithItems(order, user.role === "kitchen")),
  );
  return result;
}

async function getOrderById(id: number, includeKitchenInstructions: boolean) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);
  return order ? orderWithItems(order, includeKitchenInstructions) : null;
}

function aggregateRecipe(
  orderItems: { menuItemId: number; quantity: number }[],
  recipes: { menuItemId: number; ingredientId: number; quantity: number }[],
) {
  const recipeByMenuItem = new Map<number, typeof recipes>();
  for (const recipe of recipes) {
    const current = recipeByMenuItem.get(recipe.menuItemId) ?? [];
    current.push(recipe);
    recipeByMenuItem.set(recipe.menuItemId, current);
  }
  const needs = new Map<number, number>();
  for (const item of orderItems) {
    const recipe = recipeByMenuItem.get(item.menuItemId) ?? [];
    if (recipe.length === 0) {
      throw new OrderConflictError("Ürünün reçetesi eksik; mutfak başlamadan önce admin reçeteyi tamamlamalı.");
    }
    for (const ingredient of recipe) {
      needs.set(
        ingredient.ingredientId,
        (needs.get(ingredient.ingredientId) ?? 0) + ingredient.quantity * item.quantity,
      );
    }
  }
  return needs;
}

async function consumeRecipeStock(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orderId: number,
  branchId: number,
  actorUserId: number,
) {
  const items = await tx
    .select({ menuItemId: orderItemsTable.menuItemId, quantity: orderItemsTable.quantity })
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, orderId));
  const menuItemIds = [...new Set(items.map((item) => item.menuItemId))];
  const recipes = await tx
    .select({
      menuItemId: recipeIngredientsTable.menuItemId,
      ingredientId: recipeIngredientsTable.ingredientId,
      quantity: recipeIngredientsTable.quantity,
    })
    .from(recipeIngredientsTable)
    .where(inArray(recipeIngredientsTable.menuItemId, menuItemIds));
  const needs = aggregateRecipe(items, recipes);
  const ingredientIds = [...needs.keys()].sort((a, b) => a - b);
  const stockRows = await tx
    .select()
    .from(branchInventoryTable)
    .where(
      and(
        eq(branchInventoryTable.branchId, branchId),
        inArray(branchInventoryTable.ingredientId, ingredientIds),
      ),
    )
    .orderBy(branchInventoryTable.ingredientId)
    .for("update");
  const stockByIngredient = new Map(stockRows.map((row) => [row.ingredientId, row]));
  const names = await tx
    .select({ id: ingredientsTable.id, name: ingredientsTable.name })
    .from(ingredientsTable)
    .where(inArray(ingredientsTable.id, ingredientIds));
  const nameByIngredient = new Map(names.map((ingredient) => [ingredient.id, ingredient.name]));

  for (const [ingredientId, needed] of needs) {
    const stock = stockByIngredient.get(ingredientId);
    if (!stock || stock.quantity < needed) {
      const name = nameByIngredient.get(ingredientId) ?? "Malzeme";
      throw new OrderConflictError(`Yetersiz stok: ${name}. Şube sorumlusu stok kaydını kontrol etmeli.`);
    }
  }

  for (const [ingredientId, needed] of needs) {
    const stock = stockByIngredient.get(ingredientId)!;
    await tx
      .update(branchInventoryTable)
      .set({ quantity: String(stock.quantity - needed), updatedAt: new Date() })
      .where(eq(branchInventoryTable.id, stock.id));
    await tx.insert(inventoryTransactionsTable).values({
      branchId,
      ingredientId,
      type: "order_use",
      quantityDelta: String(-needed),
      note: `Sipariş CV-${String(orderId).padStart(4, "0")} için`,
      orderId,
      actorUserId,
    });
  }
}

router.get(
  "/orders",
  requireCafeUser(["customer", "admin", "branch_manager", "cashier", "kitchen"]),
  async (req, res): Promise<void> => {
    const params = ListOrdersQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const user = getCafeUser(res);
    const orders = await listOrders(user, params.data.status, 100);
    res.json(ListOrdersResponse.parse(orders));
  },
);

router.post(
  "/orders",
  requireCafeUser(["customer", "cashier"]),
  async (req, res): Promise<void> => {
    const parsed = CreateOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const user = getCafeUser(res);
    const branchId = user.role === "cashier" ? user.branchId! : parsed.data.branchId;
    if (user.role === "cashier" && parsed.data.branchId !== branchId) {
      res.status(403).json({ error: "Kasiyer yalnızca kendi şubesinde sipariş açabilir." });
      return;
    }
    const [branch] = await db
      .select({ id: branchesTable.id })
      .from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.active, true)))
      .limit(1);
    if (!branch) {
      res.status(400).json({ error: "Aktif bir şube seçin." });
      return;
    }
    const customerName =
      user.role === "cashier" ? parsed.data.customerName?.trim() : user.fullName;
    if (!customerName) {
      res.status(400).json({ error: "Kasiyer siparişi için müşteri adı gerekli." });
      return;
    }

    const quantities = new Map<number, number>();
    for (const item of parsed.data.items) {
      quantities.set(item.menuItemId, (quantities.get(item.menuItemId) ?? 0) + item.quantity);
    }
    if ([...quantities.values()].some((quantity) => quantity > 50)) {
      res.status(400).json({ error: "Bir üründen en fazla 50 adet sipariş edilebilir." });
      return;
    }
    const menuRows = await db
      .select()
      .from(branchMenuItemsTable)
      .innerJoin(menuItemsTable, eq(branchMenuItemsTable.menuItemId, menuItemsTable.id))
      .where(
        and(
          eq(branchMenuItemsTable.branchId, branchId),
          inArray(branchMenuItemsTable.menuItemId, [...quantities.keys()]),
        ),
      );
    const menuById = new Map(menuRows.map((row) => [row.menu_items.id, row]));
    if (menuById.size !== quantities.size) {
      res.status(400).json({ error: "Bir veya daha fazla ürün bu şubenin menüsünde yok." });
      return;
    }
    if (
      menuRows.some(
        ({ branch_menu_items: branchItem, menu_items: item }) =>
          !branchItem.available || !item.available || item.archived,
      )
    ) {
      res.status(400).json({ error: "Bir veya daha fazla ürün şu anda siparişe kapalı." });
      return;
    }

    const recipes = await db
      .select({
        menuItemId: recipeIngredientsTable.menuItemId,
        ingredientId: recipeIngredientsTable.ingredientId,
        quantity: recipeIngredientsTable.quantity,
      })
      .from(recipeIngredientsTable)
      .where(inArray(recipeIngredientsTable.menuItemId, [...quantities.keys()]));
    let needs: Map<number, number>;
    try {
      needs = aggregateRecipe(
        [...quantities.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
        recipes,
      );
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Ürün reçetesi eksik." });
      return;
    }
    const stockRows = needs.size
      ? await db
          .select()
          .from(branchInventoryTable)
          .where(
            and(
              eq(branchInventoryTable.branchId, branchId),
              inArray(branchInventoryTable.ingredientId, [...needs.keys()]),
            ),
          )
      : [];
    const stockByIngredient = new Map(stockRows.map((row) => [row.ingredientId, row.quantity]));
    const ingredientNames = needs.size
      ? await db
          .select({ id: ingredientsTable.id, name: ingredientsTable.name })
          .from(ingredientsTable)
          .where(inArray(ingredientsTable.id, [...needs.keys()]))
      : [];
    const ingredientNameById = new Map(ingredientNames.map((item) => [item.id, item.name]));
    for (const [ingredientId, needed] of needs) {
      if ((stockByIngredient.get(ingredientId) ?? 0) < needed) {
        res.status(409).json({
          error: `Yetersiz stok: ${ingredientNameById.get(ingredientId) ?? "Malzeme"}.`,
        });
        return;
      }
    }

    const lineItems = [...quantities.entries()].map(([menuItemId, quantity]) => {
      const row = menuById.get(menuItemId)!;
      return {
        menuItemId,
        quantity,
        name: row.menu_items.name,
        unitPrice: Number(row.branch_menu_items.priceOverride ?? row.menu_items.price),
      };
    });
    const total = Number(
      lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2),
    );

    const id = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(ordersTable)
        .values({
          customerName,
          branchId,
          customerUserId: user.role === "customer" ? user.id : null,
          source: user.role === "cashier" ? "cashier" : "customer",
          note: parsed.data.note?.trim() || null,
          total,
        })
        .returning({ id: ordersTable.id });
      await tx.insert(orderItemsTable).values(
        lineItems.map((item) => ({
          orderId: order.id,
          menuItemId: item.menuItemId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
        })),
      );
      return order.id;
    });

    const order = await getOrderById(id, false);
    if (!order) {
      res.status(500).json({ error: "Sipariş oluşturuldu ancak yüklenemedi." });
      return;
    }
    req.log.info(
      { orderId: id, source: user.role === "cashier" ? "cashier" : "customer", branchId, total },
      "Created café order",
    );
    res.status(201).json(CreateOrderResponse.parse(order));
  },
);

router.get(
  "/orders/:id",
  requireCafeUser(["customer", "admin", "branch_manager", "cashier", "kitchen"]),
  async (req, res): Promise<void> => {
    const params = GetOrderParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const user = getCafeUser(res);
    const [raw] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, params.data.id))
      .limit(1);
    if (!raw) {
      res.status(404).json({ error: "Sipariş bulunamadı." });
      return;
    }
    const canView =
      user.role === "admin" ||
      (user.role === "customer" && raw.customerUserId === user.id) ||
      (user.role !== "customer" && raw.branchId === user.branchId);
    if (!canView) {
      res.status(404).json({ error: "Sipariş bulunamadı." });
      return;
    }
    const order = await orderWithItems(raw, user.role === "kitchen");
    res.json(GetOrderResponse.parse(order));
  },
);

router.patch(
  "/orders/:id/status",
  requireCafeUser(["admin", "cashier", "kitchen"]),
  async (req, res): Promise<void> => {
    const params = UpdateOrderStatusParams.safeParse(req.params);
    const parsed = UpdateOrderStatusBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: params.error?.message ?? parsed.error?.message });
      return;
    }

    const user = getCafeUser(res);
    let updatedId: number;
    try {
      updatedId = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.id, params.data.id))
          .for("update")
          .limit(1);
        if (!current) throw new OrderConflictError("Sipariş bulunamadı.");
        if (user.role !== "admin" && current.branchId !== user.branchId) {
          throw new OrderConflictError("Bu sipariş başka bir şubeye ait.");
        }
        const requestedStatus = parsed.data.status as OrderStatus;
        if (nextStatus[current.status] !== requestedStatus) {
          throw new OrderConflictError(
            `Sipariş ${current.status} durumundan ${requestedStatus} durumuna geçirilemez.`,
          );
        }
        if (
          (user.role === "kitchen" && requestedStatus === "completed") ||
          (user.role === "cashier" && requestedStatus !== "completed")
        ) {
          throw new OrderConflictError("Bu rol bu sipariş adımını tamamlayamaz.");
        }
        if (requestedStatus === "preparing") {
          if (current.branchId === null) {
            throw new OrderConflictError("Şubesi olmayan eski sipariş mutfağa alınamaz.");
          }
          await consumeRecipeStock(tx, current.id, current.branchId, user.id);
        }
        const [updated] = await tx
          .update(ordersTable)
          .set({ status: requestedStatus, updatedAt: new Date() })
          .where(and(eq(ordersTable.id, current.id), eq(ordersTable.status, current.status)))
          .returning({ id: ordersTable.id });
        if (!updated) throw new OrderConflictError("Sipariş başka bir çalışan tarafından güncellendi.");
        return updated.id;
      });
    } catch (error) {
      if (error instanceof OrderConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Failed to advance café order");
      res.status(500).json({ error: "Sipariş durumu güncellenemedi." });
      return;
    }

    const order = await getOrderById(updatedId, user.role === "kitchen");
    if (!order) {
      res.status(404).json({ error: "Sipariş bulunamadı." });
      return;
    }
    req.log.info({ orderId: updatedId, status: parsed.data.status }, "Advanced café order");
    res.json(UpdateOrderStatusResponse.parse(order));
  },
);

router.get(
  "/dashboard-summary",
  requireCafeUser(["admin", "branch_manager", "cashier", "kitchen"]),
  async (_req, res): Promise<void> => {
    const user = getCafeUser(res);
    const scope = orderScope(user);
    const [summary] = await db
      .select({
        pending: sql<number>`(count(*) filter (where ${ordersTable.status} = 'pending'))::int`,
        preparing: sql<number>`(count(*) filter (where ${ordersTable.status} = 'preparing'))::int`,
        ready: sql<number>`(count(*) filter (where ${ordersTable.status} = 'ready'))::int`,
        completedToday: sql<number>`(count(*) filter (
          where ${ordersTable.status} = 'completed'
            and ${ordersTable.updatedAt} >= (
              date_trunc('day', now() at time zone 'Europe/Istanbul')
              at time zone 'Europe/Istanbul'
            )
        ))::int`,
        revenueToday: sql<number>`coalesce(sum(${ordersTable.total}) filter (
          where ${ordersTable.status} = 'completed'
            and ${ordersTable.updatedAt} >= (
              date_trunc('day', now() at time zone 'Europe/Istanbul')
              at time zone 'Europe/Istanbul'
            )
        ), 0)`,
      })
      .from(ordersTable)
      .where(scope);
    const recentOrders = await listOrders(user, undefined, 6);
    res.json(
      GetDashboardSummaryResponse.parse({
        pending: Number(summary.pending),
        preparing: Number(summary.preparing),
        ready: Number(summary.ready),
        completedToday: Number(summary.completedToday),
        revenueToday: Number(summary.revenueToday),
        recentOrders,
      }),
    );
  },
);

export default router;
