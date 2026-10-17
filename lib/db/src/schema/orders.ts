import { createInsertSchema } from "drizzle-zod";
import { index, numeric, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "preparing",
  "ready",
  "completed",
]);

export const orderSourceEnum = pgEnum("order_source", ["customer", "cashier"]);

export const ordersTable = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    customerName: text("customer_name").notNull(),
    source: orderSourceEnum("source").notNull(),
    status: orderStatusEnum("status").notNull().default("pending"),
    note: text("note"),
    total: numeric("total", { precision: 10, scale: 2, mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("orders_status_created_idx").on(table.status, table.createdAt),
    index("orders_created_idx").on(table.createdAt),
  ],
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrder = typeof ordersTable.$inferInsert;
export type Order = typeof ordersTable.$inferSelect;
