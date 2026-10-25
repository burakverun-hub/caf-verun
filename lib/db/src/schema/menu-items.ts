import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { boolean, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const menuItemsTable = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  price: numeric("price", { precision: 10, scale: 2, mode: "number" }).notNull(),
  available: boolean("available").notNull().default(true),
  publicIngredients: jsonb("public_ingredients").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  allergens: jsonb("allergens").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  kitchenInstructions: text("kitchen_instructions").notNull().default(""),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMenuItemSchema = createInsertSchema(menuItemsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMenuItem = typeof menuItemsTable.$inferInsert;
export type MenuItem = typeof menuItemsTable.$inferSelect;
