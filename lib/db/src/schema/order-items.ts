import { createInsertSchema } from "drizzle-zod";
import { integer, numeric, pgTable, serial, text } from "drizzle-orm/pg-core";
import { menuItemsTable } from "./menu-items";
import { ordersTable } from "./orders";

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  menuItemId: integer("menu_item_id")
    .notNull()
    .references(() => menuItemsTable.id),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2, mode: "number" }).notNull(),
});

export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({
  id: true,
});

export type InsertOrderItem = typeof orderItemsTable.$inferInsert;
export type OrderItem = typeof orderItemsTable.$inferSelect;
