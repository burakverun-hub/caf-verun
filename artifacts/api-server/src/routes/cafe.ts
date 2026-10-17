import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateOrderBody,
  CreateOrderResponse,
  GetDashboardSummaryResponse,
  GetOrderParams,
  GetOrderResponse,
  ListMenuResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdateOrderStatusResponse,
} from "@workspace/api-zod";
import {
  db,
  menuItemsTable,
  orderItemsTable,
  ordersTable,
  orderStatusEnum,
} from "@workspace/db";

const router: IRouter = Router();
type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

const nextStatus: Record<OrderStatus, OrderStatus | null> = {
  pending: "preparing",
  preparing: "ready",
  ready: "completed",
  completed: null,
};

function orderNumber(id: number): string {
  return `CV-${String(id).padStart(4, "0")}`;
}

function toOrderResponse(
  order: typeof ordersTable.$inferSelect,
  items: (typeof orderItemsTable.$inferSelect)[],
) {
  return {
    id: order.id,
    orderNumber: orderNumber(order.id),
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
    })),
    total: Number(order.total),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

async function getOrder(id: number) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!order) return null;

  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, id))
    .orderBy(orderItemsTable.id);

  return toOrderResponse(order, items);
}

async function getOrders(options: { status?: OrderStatus; limit: number }) {
  const orderRows = await db
    .select()
    .from(ordersTable)
    .where(options.status ? eq(ordersTable.status, options.status) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(options.limit);

  if (orderRows.length === 0) return [];

  const itemRows = await db
    .select()
    .from(orderItemsTable)
    .where(
      inArray(
        orderItemsTable.orderId,
        orderRows.map((order) => order.id),
      ),
    )
    .orderBy(orderItemsTable.id);

  const itemsByOrder = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const currentItems = itemsByOrder.get(item.orderId) ?? [];
    currentItems.push(item);
    itemsByOrder.set(item.orderId, currentItems);
  }

  return orderRows.map((order) =>
    toOrderResponse(order, itemsByOrder.get(order.id) ?? []),
  );
}

router.get("/menu", async (req, res): Promise<void> => {
  const menu = await db
    .select({
      id: menuItemsTable.id,
      name: menuItemsTable.name,
      description: menuItemsTable.description,
      category: menuItemsTable.category,
      price: menuItemsTable.price,
      available: menuItemsTable.available,
    })
    .from(menuItemsTable)
    .where(eq(menuItemsTable.available, true))
    .orderBy(menuItemsTable.category, menuItemsTable.name);

  req.log.info({ count: menu.length }, "Listed café menu");
  res.json(ListMenuResponse.parse(menu));
});

router.get("/orders", async (req, res): Promise<void> => {
  const params = ListOrdersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orders = await getOrders({
    status: params.data.status,
    limit: 100,
  });
  req.log.info({ count: orders.length, status: params.data.status }, "Listed café orders");
  res.json(ListOrdersResponse.parse(orders));
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const customerName = parsed.data.customerName.trim();
  if (customerName.length === 0) {
    res.status(400).json({ error: "Customer name cannot be blank" });
    return;
  }

  const quantities = new Map<number, number>();
  for (const item of parsed.data.items) {
    quantities.set(
      item.menuItemId,
      (quantities.get(item.menuItemId) ?? 0) + item.quantity,
    );
  }
  if ([...quantities.values()].some((quantity) => quantity > 50)) {
    res.status(400).json({ error: "An item quantity cannot exceed 50" });
    return;
  }

  const menuItems = await db
    .select()
    .from(menuItemsTable)
    .where(inArray(menuItemsTable.id, [...quantities.keys()]));
  const menuById = new Map(menuItems.map((item) => [item.id, item]));
  if (menuById.size !== quantities.size) {
    res.status(400).json({ error: "One or more menu items no longer exist" });
    return;
  }
  if (menuItems.some((item) => !item.available)) {
    res.status(400).json({ error: "One or more menu items are unavailable" });
    return;
  }

  const lineItems = [...quantities.entries()].map(([menuItemId, quantity]) => {
    const menuItem = menuById.get(menuItemId)!;
    return {
      menuItemId,
      quantity,
      name: menuItem.name,
      unitPrice: Number(menuItem.price),
    };
  });
  const total = Number(
    lineItems
      .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
      .toFixed(2),
  );

  const id = await db.transaction(async (transaction) => {
    const [order] = await transaction
      .insert(ordersTable)
      .values({
        customerName,
        source: parsed.data.source,
        note: parsed.data.note?.trim() || null,
        total,
      })
      .returning({ id: ordersTable.id });

    await transaction.insert(orderItemsTable).values(
      lineItems.map((item) => ({
        orderId: order.id,
        menuItemId: item.menuItemId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    );
    return order.id;
  });

  const order = await getOrder(id);
  if (!order) {
    res.status(500).json({ error: "The order was created but could not be loaded" });
    return;
  }

  req.log.info(
    { orderId: id, source: parsed.data.source, total },
    "Created café order",
  );
  res.status(201).json(CreateOrderResponse.parse(order));
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const order = await getOrder(params.data.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(GetOrderResponse.parse(order));
});

router.patch("/orders/:id/status", async (req, res): Promise<void> => {
  const params = UpdateOrderStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [current] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (nextStatus[current.status] !== parsed.data.status) {
    res.status(400).json({
      error: `Order cannot move from ${current.status} to ${parsed.data.status}`,
    });
    return;
  }

  const [updated] = await db
    .update(ordersTable)
    .set({ status: parsed.data.status })
    .where(
      and(
        eq(ordersTable.id, params.data.id),
        eq(ordersTable.status, current.status),
      ),
    )
    .returning({ id: ordersTable.id });

  if (!updated) {
    res.status(409).json({ error: "This order was updated by another staff member" });
    return;
  }

  const order = await getOrder(updated.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  req.log.info(
    { orderId: updated.id, status: parsed.data.status },
    "Advanced café order",
  );
  res.json(UpdateOrderStatusResponse.parse(order));
});

router.get("/dashboard-summary", async (_req, res): Promise<void> => {
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
    .from(ordersTable);

  const recentOrders = await getOrders({ limit: 6 });
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
});

export default router;
