import { integer, numeric, pgTable, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { ingredientsTable } from "./ingredients";
import { menuItemsTable } from "./menu-items";

export const recipeIngredientsTable = pgTable(
  "recipe_ingredients",
  {
    id: serial("id").primaryKey(),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id),
    quantity: numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("recipe_ingredients_item_ingredient_unique").on(table.menuItemId, table.ingredientId)],
);

export type RecipeIngredient = typeof recipeIngredientsTable.$inferSelect;
