import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  ListBranchesResponse,
  ListCategoriesQueryParams,
  ListCategoriesResponse,
  ListMenuQueryParams,
  ListMenuResponse,
} from "@workspace/api-zod";
import {
  branchInventoryTable,
  branchMenuItemsTable,
  branchesTable,
  db,
  ingredientsTable,
  menuCategoriesTable,
  menuItemsTable,
  recipeIngredientsTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/branches", async (_req, res): Promise<void> => {
  const branches = await db
    .select()
    .from(branchesTable)
    .where(eq(branchesTable.active, true))
    .orderBy(branchesTable.name);
  res.json(
    ListBranchesResponse.parse(
      branches.map((branch) => ({ ...branch, createdAt: branch.createdAt.toISOString() })),
    ),
  );
});

router.get("/menu", async (req, res): Promise<void> => {
  const query = ListMenuQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const branchId = Number(query.data.branchId);
  const [branch] = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(eq(branchesTable.id, branchId), eq(branchesTable.active, true)))
    .limit(1);
  if (!branch) {
    res.status(404).json({ error: "Şube bulunamadı veya kapalı." });
    return;
  }

  const rows = await db
    .select()
    .from(branchMenuItemsTable)
    .innerJoin(menuItemsTable, eq(branchMenuItemsTable.menuItemId, menuItemsTable.id))
    .where(
      and(
        eq(branchMenuItemsTable.branchId, branchId),
        eq(menuItemsTable.archived, false),
      ),
    )
    .orderBy(menuItemsTable.category, menuItemsTable.name);

  if (rows.length === 0) {
    res.json(ListMenuResponse.parse([]));
    return;
  }
  const menuIds = rows.map(({ menu_items: item }) => item.id);
  const recipeRows = await db
    .select({
      menuItemId: recipeIngredientsTable.menuItemId,
      ingredientId: ingredientsTable.id,
      quantity: recipeIngredientsTable.quantity,
    })
    .from(recipeIngredientsTable)
    .innerJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(inArray(recipeIngredientsTable.menuItemId, menuIds));
  const inventoryRows = await db
    .select()
    .from(branchInventoryTable)
    .where(
      and(
        eq(branchInventoryTable.branchId, branchId),
        inArray(branchInventoryTable.ingredientId, [
          ...new Set(recipeRows.map((row) => row.ingredientId)),
        ]),
      ),
    );
  const quantityByIngredient = new Map(inventoryRows.map((row) => [row.ingredientId, row.quantity]));
  const recipeByMenuItem = new Map<number, typeof recipeRows>();
  for (const recipeRow of recipeRows) {
    const current = recipeByMenuItem.get(recipeRow.menuItemId) ?? [];
    current.push(recipeRow);
    recipeByMenuItem.set(recipeRow.menuItemId, current);
  }

  const categoryIds = [
    ...new Set(
      rows
        .map(({ branch_menu_items: branchItem }) => branchItem.categoryId)
        .filter((id): id is number => id !== null),
    ),
  ];
  const categoryRows = categoryIds.length
    ? await db
        .select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name })
        .from(menuCategoriesTable)
        .where(inArray(menuCategoriesTable.id, categoryIds))
    : [];
  const categoryById = new Map(categoryRows.map((category) => [category.id, category.name]));

  const menu = rows.map(({ branch_menu_items: branchItem, menu_items: item }) => {
    const recipe = recipeByMenuItem.get(item.id) ?? [];
    const stockAvailable =
      recipe.length > 0 &&
      recipe.every((ingredient) => (quantityByIngredient.get(ingredient.ingredientId) ?? 0) >= ingredient.quantity);

    return {
      branchId,
      item: {
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        price: Number(item.price),
        available: item.available,
        publicIngredients: item.publicIngredients,
        allergens: item.allergens,
      },
      price: Number(branchItem.priceOverride ?? item.price),
      available: branchItem.available && item.available && stockAvailable,
      categoryName: categoryById.get(branchItem.categoryId ?? -1) ?? item.category,
      categoryId: branchItem.categoryId,
      stockAvailable,
    };
  });

  res.json(ListMenuResponse.parse(menu));
});

router.get("/categories", async (req, res): Promise<void> => {
  const query = ListCategoriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const branchId = Number(query.data.branchId);
  const [branch] = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(eq(branchesTable.id, branchId), eq(branchesTable.active, true)))
    .limit(1);
  if (!branch) {
    res.status(404).json({ error: "Şube bulunamadı veya kapalı." });
    return;
  }

  const categories = await db
    .select()
    .from(menuCategoriesTable)
    .where(
      and(
        eq(menuCategoriesTable.active, true),
        or(isNull(menuCategoriesTable.branchId), eq(menuCategoriesTable.branchId, branchId)),
      ),
    )
    .orderBy(menuCategoriesTable.name);
  res.json(ListCategoriesResponse.parse(categories));
});

export default router;
