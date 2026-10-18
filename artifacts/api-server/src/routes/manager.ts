import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateManagerCategoryBody,
  CreateManagerCategoryResponse,
  CreateManagerInventoryTransactionBody,
  CreateManagerInventoryTransactionResponse,
  GetManagerOverviewResponse,
  ListManagerInventoryResponse,
  ListManagerInventoryTransactionsQueryParams,
  ListManagerInventoryTransactionsResponse,
  ListManagerMenuResponse,
  ListManagerStaffResponse,
  RemoveManagerMenuItemParams,
  UpdateManagerMenuBody,
  UpdateManagerMenuParams,
  UpdateManagerMenuResponse,
} from "@workspace/api-zod";
import {
  appUsersTable,
  branchInventoryTable,
  branchMenuItemsTable,
  branchesTable,
  db,
  ingredientsTable,
  inventoryTransactionsTable,
  menuCategoriesTable,
  menuItemsTable,
  orderStatusEnum,
  ordersTable,
  recipeIngredientsTable,
} from "@workspace/db";
import { getCafeUser, requireCafeUser } from "../middlewares/cafeAuth";

const router: IRouter = Router();
type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

function publicProduct(item: typeof menuItemsTable.$inferSelect) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    price: Number(item.price),
    available: item.available,
    publicIngredients: item.publicIngredients,
    allergens: item.allergens,
  };
}

async function inventoryForBranch(branchId: number) {
  const [ingredients, inventory] = await Promise.all([
    db
      .select()
      .from(ingredientsTable)
      .where(eq(ingredientsTable.archived, false))
      .orderBy(ingredientsTable.name),
    db
      .select()
      .from(branchInventoryTable)
      .where(eq(branchInventoryTable.branchId, branchId)),
  ]);
  const inventoryByIngredient = new Map(inventory.map((row) => [row.ingredientId, row]));
  return ingredients.map((ingredient) => {
    const stock = inventoryByIngredient.get(ingredient.id);
    const quantity = stock?.quantity ?? 0;
    const lowStockThreshold = stock?.lowStockThreshold ?? 0;
    return {
      id: stock?.id ?? 0,
      branchId,
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity,
      lowStockThreshold,
      isLow: quantity <= 0 || (lowStockThreshold > 0 && quantity <= lowStockThreshold),
      updatedAt: (stock?.updatedAt ?? ingredient.updatedAt).toISOString(),
    };
  });
}

async function branchMenuRows(branchId: number) {
  const rows = await db
    .select()
    .from(branchMenuItemsTable)
    .innerJoin(menuItemsTable, eq(branchMenuItemsTable.menuItemId, menuItemsTable.id))
    .where(
      and(
        eq(branchMenuItemsTable.branchId, branchId),
        eq(menuItemsTable.archived, false),
      ),
    )
    .orderBy(menuItemsTable.category, menuItemsTable.name);

  if (rows.length === 0) return [];
  const menuIds = rows.map(({ menu_items: item }) => item.id);
  const recipes = await db
    .select({
      menuItemId: recipeIngredientsTable.menuItemId,
      ingredientId: recipeIngredientsTable.ingredientId,
      quantity: recipeIngredientsTable.quantity,
    })
    .from(recipeIngredientsTable)
    .where(inArray(recipeIngredientsTable.menuItemId, menuIds));
  const ingredientIds = [...new Set(recipes.map((recipe) => recipe.ingredientId))];
  const inventory = ingredientIds.length
    ? await db
        .select()
        .from(branchInventoryTable)
        .where(
          and(
            eq(branchInventoryTable.branchId, branchId),
            inArray(branchInventoryTable.ingredientId, ingredientIds),
          ),
        )
    : [];
  const stockByIngredient = new Map(inventory.map((row) => [row.ingredientId, row.quantity]));
  const recipesByItem = new Map<number, typeof recipes>();
  for (const recipe of recipes) {
    const current = recipesByItem.get(recipe.menuItemId) ?? [];
    current.push(recipe);
    recipesByItem.set(recipe.menuItemId, current);
  }
  const categoryIds = [
    ...new Set(
      rows
        .map(({ branch_menu_items: row }) => row.categoryId)
        .filter((id): id is number => id !== null),
    ),
  ];
  const categories = categoryIds.length
    ? await db
        .select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name })
        .from(menuCategoriesTable)
        .where(inArray(menuCategoriesTable.id, categoryIds))
    : [];
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));

  return rows.map(({ branch_menu_items: branchItem, menu_items: item }) => {
    const recipe = recipesByItem.get(item.id) ?? [];
    const stockAvailable =
      recipe.length > 0 &&
      recipe.every((entry) => (stockByIngredient.get(entry.ingredientId) ?? 0) >= entry.quantity);
    return {
      branchId,
      item: publicProduct(item),
      price: Number(branchItem.priceOverride ?? item.price),
      available: branchItem.available && item.available && stockAvailable,
      categoryName: categoryById.get(branchItem.categoryId ?? -1) ?? item.category,
      categoryId: branchItem.categoryId,
      stockAvailable,
    };
  });
}

async function getBranchMenuItem(branchId: number, menuItemId: number) {
  const [row] = await db
    .select()
    .from(branchMenuItemsTable)
    .innerJoin(menuItemsTable, eq(branchMenuItemsTable.menuItemId, menuItemsTable.id))
    .where(
      and(
        eq(branchMenuItemsTable.branchId, branchId),
        eq(branchMenuItemsTable.menuItemId, menuItemId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [mapped] = (await branchMenuRows(branchId)).filter((menuItem) => menuItem.item.id === menuItemId);
  return mapped ?? null;
}

router.get(
  "/manager/overview",
  requireCafeUser(["branch_manager"]),
  async (_req, res): Promise<void> => {
    const manager = getCafeUser(res);
    const branchId = manager.branchId!;
    const [branch] = await db
      .select()
      .from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.active, true)))
      .limit(1);
    if (!branch) {
      res.status(404).json({ error: "Şube bulunamadı veya kapalı." });
      return;
    }

    const [summary] = await db
      .select({
        pendingOrders: sql<number>`(count(*) filter (where ${ordersTable.status} = 'pending'))::int`,
        preparingOrders: sql<number>`(count(*) filter (where ${ordersTable.status} = 'preparing'))::int`,
        readyOrders: sql<number>`(count(*) filter (where ${ordersTable.status} = 'ready'))::int`,
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
      .where(eq(ordersTable.branchId, branchId));
    const inventory = await inventoryForBranch(branchId);
    const lowStockItems = inventory.filter((item) => item.isLow);

    res.json(
      GetManagerOverviewResponse.parse({
        branch: { ...branch, createdAt: branch.createdAt.toISOString() },
        pendingOrders: Number(summary.pendingOrders),
        preparingOrders: Number(summary.preparingOrders),
        readyOrders: Number(summary.readyOrders),
        completedToday: Number(summary.completedToday),
        revenueToday: Number(summary.revenueToday),
        lowStockCount: lowStockItems.length,
        lowStockItems,
      }),
    );
  },
);

router.get(
  "/manager/menu",
  requireCafeUser(["branch_manager"]),
  async (_req, res): Promise<void> => {
    const branchId = getCafeUser(res).branchId!;
    const [branchMenuItems, catalogItems] = await Promise.all([
      branchMenuRows(branchId),
      db
        .select()
        .from(menuItemsTable)
        .where(eq(menuItemsTable.archived, false))
        .orderBy(menuItemsTable.category, menuItemsTable.name),
    ]);
    const includedIds = new Set(branchMenuItems.map((item) => item.item.id));
    res.json(
      ListManagerMenuResponse.parse({
        branchId,
        menuItems: branchMenuItems,
        availableProducts: catalogItems
          .filter((item) => !includedIds.has(item.id))
          .map(publicProduct),
      }),
    );
  },
);

router.put(
  "/manager/menu/:menuItemId",
  requireCafeUser(["branch_manager"]),
  async (req, res): Promise<void> => {
    const params = UpdateManagerMenuParams.safeParse(req.params);
    const parsed = UpdateManagerMenuBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: params.error?.message ?? parsed.error?.message });
      return;
    }
    const branchId = getCafeUser(res).branchId!;
    const [item] = await db
      .select({ id: menuItemsTable.id, price: menuItemsTable.price, archived: menuItemsTable.archived })
      .from(menuItemsTable)
      .where(eq(menuItemsTable.id, params.data.menuItemId))
      .limit(1);
    if (!item || item.archived) {
      res.status(404).json({ error: "Ürün bulunamadı veya arşivlenmiş." });
      return;
    }
    if (parsed.data.categoryId !== undefined && parsed.data.categoryId !== null) {
      const [category] = await db
        .select({ id: menuCategoriesTable.id })
        .from(menuCategoriesTable)
        .where(
          and(
            eq(menuCategoriesTable.id, parsed.data.categoryId),
            eq(menuCategoriesTable.active, true),
            sql`(${menuCategoriesTable.branchId} is null or ${menuCategoriesTable.branchId} = ${branchId})`,
          ),
        )
        .limit(1);
      if (!category) {
        res.status(400).json({ error: "Bu kategori şubenizde kullanılamıyor." });
        return;
      }
    }

    const [current] = await db
      .select()
      .from(branchMenuItemsTable)
      .where(
        and(
          eq(branchMenuItemsTable.branchId, branchId),
          eq(branchMenuItemsTable.menuItemId, item.id),
        ),
      )
      .limit(1);
    if (current) {
      await db
        .update(branchMenuItemsTable)
        .set({
          available: parsed.data.available,
          ...(parsed.data.price !== undefined
            ? { priceOverride: String(parsed.data.price) }
            : {}),
          ...(parsed.data.categoryId !== undefined
            ? { categoryId: parsed.data.categoryId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(branchMenuItemsTable.id, current.id));
    } else {
      await db.insert(branchMenuItemsTable).values({
        branchId,
        menuItemId: item.id,
        available: parsed.data.available,
        priceOverride: parsed.data.price === undefined ? null : String(parsed.data.price),
        categoryId: parsed.data.categoryId ?? null,
      });
    }

    const result = await getBranchMenuItem(branchId, item.id);
    if (!result) {
      res.status(500).json({ error: "Şube menüsü güncellenemedi." });
      return;
    }
    res.json(UpdateManagerMenuResponse.parse(result));
  },
);

router.delete(
  "/manager/menu/:menuItemId",
  requireCafeUser(["branch_manager"]),
  async (req, res): Promise<void> => {
    const params = RemoveManagerMenuItemParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const branchId = getCafeUser(res).branchId!;
    await db
      .delete(branchMenuItemsTable)
      .where(
        and(
          eq(branchMenuItemsTable.branchId, branchId),
          eq(branchMenuItemsTable.menuItemId, params.data.menuItemId),
        ),
      );
    res.status(204).end();
  },
);

router.post(
  "/manager/categories",
  requireCafeUser(["branch_manager"]),
  async (req, res): Promise<void> => {
    const parsed = CreateManagerCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const branchId = getCafeUser(res).branchId!;
    const name = parsed.data.name.trim();
    const [existing] = await db
      .select({ id: menuCategoriesTable.id })
      .from(menuCategoriesTable)
      .where(
        and(
          eq(menuCategoriesTable.branchId, branchId),
          eq(menuCategoriesTable.name, name),
        ),
      )
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Bu şube kategorisi zaten var." });
      return;
    }
    const [category] = await db
      .insert(menuCategoriesTable)
      .values({ branchId, name })
      .returning();
    res.status(201).json(CreateManagerCategoryResponse.parse(category));
  },
);

router.get(
  "/manager/inventory",
  requireCafeUser(["branch_manager"]),
  async (_req, res): Promise<void> => {
    const inventory = await inventoryForBranch(getCafeUser(res).branchId!);
    res.json(ListManagerInventoryResponse.parse(inventory));
  },
);

router.get(
  "/manager/inventory/transactions",
  requireCafeUser(["branch_manager"]),
  async (req, res): Promise<void> => {
    const params = ListManagerInventoryTransactionsQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const branchId = getCafeUser(res).branchId!;
    const rows = await db
      .select({
        transaction: inventoryTransactionsTable,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        actorName: appUsersTable.fullName,
      })
      .from(inventoryTransactionsTable)
      .innerJoin(ingredientsTable, eq(inventoryTransactionsTable.ingredientId, ingredientsTable.id))
      .leftJoin(appUsersTable, eq(inventoryTransactionsTable.actorUserId, appUsersTable.id))
      .where(eq(inventoryTransactionsTable.branchId, branchId))
      .orderBy(desc(inventoryTransactionsTable.createdAt))
      .limit(params.data.limit ?? 50);
    res.json(
      ListManagerInventoryTransactionsResponse.parse(
        rows.map(({ transaction, ingredientName, unit, actorName }) => ({
          id: transaction.id,
          branchId: transaction.branchId,
          ingredientId: transaction.ingredientId,
          ingredientName,
          unit,
          type: transaction.type,
          quantityDelta: transaction.quantityDelta,
          note: transaction.note,
          orderId: transaction.orderId,
          actorName: actorName ?? "Sistem",
          createdAt: transaction.createdAt.toISOString(),
        })),
      ),
    );
  },
);

router.post(
  "/manager/inventory/transactions",
  requireCafeUser(["branch_manager"]),
  async (req, res): Promise<void> => {
    const parsed = CreateManagerInventoryTransactionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const manager = getCafeUser(res);
    const branchId = manager.branchId!;
    const input = parsed.data;
    const [ingredient] = await db
      .select()
      .from(ingredientsTable)
      .where(and(eq(ingredientsTable.id, input.ingredientId), eq(ingredientsTable.archived, false)))
      .limit(1);
    if (!ingredient) {
      res.status(404).json({ error: "Stok malzemesi bulunamadı." });
      return;
    }

    const delta =
      input.type === "restock"
        ? input.quantity
        : input.type === "waste"
          ? -Math.abs(input.quantity)
          : input.quantity;
    if (delta === 0) {
      res.status(400).json({ error: "Stok hareketi sıfır olamaz." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(branchInventoryTable)
        .where(
          and(
            eq(branchInventoryTable.branchId, branchId),
            eq(branchInventoryTable.ingredientId, ingredient.id),
          ),
        )
        .for("update")
        .limit(1);
      const nextQuantity = (current?.quantity ?? 0) + delta;
      if (nextQuantity < 0) {
        throw new Error("Stok miktarı sıfırın altına inemez.");
      }
      const stock = current
        ? (
            await tx
              .update(branchInventoryTable)
              .set({
                quantity: String(nextQuantity),
                ...(input.lowStockThreshold !== undefined
                  ? { lowStockThreshold: String(input.lowStockThreshold) }
                  : {}),
                updatedAt: new Date(),
              })
              .where(eq(branchInventoryTable.id, current.id))
              .returning()
          )[0]
        : (
            await tx
              .insert(branchInventoryTable)
              .values({
                branchId,
                ingredientId: ingredient.id,
                quantity: String(nextQuantity),
                lowStockThreshold: String(input.lowStockThreshold ?? 0),
              })
              .returning()
          )[0];
      const [transaction] = await tx
        .insert(inventoryTransactionsTable)
        .values({
          branchId,
          ingredientId: ingredient.id,
          type: input.type,
          quantityDelta: String(delta),
          note: input.note.trim() || null,
          actorUserId: manager.id,
        })
        .returning();
      return { stock, transaction };
    });

    res.status(201).json(
      CreateManagerInventoryTransactionResponse.parse({
        id: result.transaction.id,
        branchId,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        type: result.transaction.type,
        quantityDelta: result.transaction.quantityDelta,
        note: result.transaction.note,
        orderId: null,
        actorName: manager.fullName,
        createdAt: result.transaction.createdAt.toISOString(),
      }),
    );
  },
);

router.get(
  "/manager/staff",
  requireCafeUser(["branch_manager"]),
  async (_req, res): Promise<void> => {
    const branchId = getCafeUser(res).branchId!;
    const staff = await db
      .select({ user: appUsersTable, branchName: branchesTable.name })
      .from(appUsersTable)
      .leftJoin(branchesTable, eq(appUsersTable.branchId, branchesTable.id))
      .where(and(eq(appUsersTable.branchId, branchId), eq(appUsersTable.role, "cashier")))
      .orderBy(appUsersTable.fullName);
    res.json(
      ListManagerStaffResponse.parse(
        staff.map(({ user, branchName }) => ({
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          branchId: user.branchId,
          branchName,
          staffCode: user.staffCode,
          active: user.active,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
        })),
      ),
    );
  },
);

export default router;
