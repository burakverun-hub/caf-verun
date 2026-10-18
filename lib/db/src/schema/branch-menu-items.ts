import { boolean, integer, numeric, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";
import { menuCategoriesTable } from "./menu-categories";
import { menuItemsTable } from "./menu-items";

export const branchMenuItemsTable = pgTable(
  "branch_menu_items",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
    categoryId: integer("category_id").references(() => menuCategoriesTable.id, { onDelete: "set null" }),
    priceOverride: numeric("price_override", { precision: 10, scale: 2, mode: "number" }),
    available: boolean("available").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("branch_menu_items_branch_item_unique").on(table.branchId, table.menuItemId),
    uniqueIndex("branch_menu_items_id_branch_unique").on(table.id, table.branchId),
  ],
);

export type BranchMenuItem = typeof branchMenuItemsTable.$inferSelect;
