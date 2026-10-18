import { index, integer, numeric, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";
import { ingredientsTable } from "./ingredients";

export const branchInventoryTable = pgTable(
  "branch_inventory",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id),
    quantity: numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
    lowStockThreshold: numeric("low_stock_threshold", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("branch_inventory_branch_ingredient_unique").on(table.branchId, table.ingredientId),
    index("branch_inventory_branch_updated_idx").on(table.branchId, table.updatedAt),
  ],
);

export type BranchInventory = typeof branchInventoryTable.$inferSelect;
