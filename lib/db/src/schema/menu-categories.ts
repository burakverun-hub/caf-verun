import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";

export const menuCategoriesTable = pgTable(
  "menu_categories",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("menu_categories_branch_active_idx").on(table.branchId, table.active, table.name)],
);

export type MenuCategory = typeof menuCategoriesTable.$inferSelect;
export type InsertMenuCategory = typeof menuCategoriesTable.$inferInsert;
