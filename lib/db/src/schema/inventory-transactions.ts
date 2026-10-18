import { index, integer, numeric, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { appUsersTable } from "./app-users";
import { branchesTable } from "./branches";
import { ingredientsTable } from "./ingredients";
import { ordersTable } from "./orders";

export const inventoryTransactionTypeEnum = pgEnum("inventory_transaction_type", [
  "restock",
  "waste",
  "adjustment",
  "order_use",
]);

export const inventoryTransactionsTable = pgTable(
  "inventory_transactions",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id),
    type: inventoryTransactionTypeEnum("type").notNull(),
    quantityDelta: numeric("quantity_delta", { precision: 12, scale: 3, mode: "number" }).notNull(),
    note: text("note"),
    orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
    actorUserId: integer("actor_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_transactions_branch_created_idx").on(table.branchId, table.createdAt),
    index("inventory_transactions_order_idx").on(table.orderId),
  ],
);

export type InventoryTransaction = typeof inventoryTransactionsTable.$inferSelect;
