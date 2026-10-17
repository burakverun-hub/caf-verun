import { createInsertSchema } from "drizzle-zod";
import { boolean, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const menuItemsTable = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  price: numeric("price", { precision: 10, scale: 2, mode: "number" }).notNull(),
  available: boolean("available").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMenuItemSchema = createInsertSchema(menuItemsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMenuItem = typeof menuItemsTable.$inferInsert;
export type MenuItem = typeof menuItemsTable.$inferSelect;
