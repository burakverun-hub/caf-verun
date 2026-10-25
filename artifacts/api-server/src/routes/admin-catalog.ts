import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import {
  CreateAdminCategoryBody,
  CreateAdminCategoryResponse,
  CreateAdminIngredientBody,
  CreateAdminIngredientResponse,
  CreateAdminMenuItemBody,
  CreateAdminMenuItemResponse,
  ListAdminCategoriesResponse,
  ListAdminIngredientsResponse,
  ListAdminMenuItemsQueryParams,
  ListAdminMenuItemsResponse,
  UpdateAdminCategoryBody,
  UpdateAdminCategoryParams,
  UpdateAdminCategoryResponse,
  UpdateAdminIngredientBody,
  UpdateAdminIngredientParams,
  UpdateAdminIngredientResponse,
  UpdateAdminMenuItemBody,
  UpdateAdminMenuItemParams,
  UpdateAdminMenuItemResponse,
} from "@workspace/api-zod";
import {
  db,
  ingredientsTable,
  menuCategoriesTable,
  menuItemsTable,
  recipeIngredientsTable,
} from "@workspace/db";
import { requireCafeUser } from "../middlewares/cafeAuth";

const router: IRouter = Router();

async function ensureGlobalCategory(name: string) {
  const [existing] = await db
    .select()
    .from(menuCategoriesTable)
    .where(and(isNull(menuCategoriesTable.branchId), eq(menuCategoriesTable.name, name)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(menuCategoriesTable)
    .values({ name, branchId: null })
    .returning();
  return created;
}

async function validateRecipe(
  recipe: { ingredientId: number; quantity: number }[],
): Promise<string | null> {
  const ids = recipe.map((entry) => entry.ingredientId);
  if (new Set(ids).size !== ids.length) return "Her içerik tarifte yalnızca bir kez bulunabilir.";
  if (ids.length === 0) return null;
  const activeIngredients = await db
    .select({ id: ingredientsTable.id })
    .from(ingredientsTable)
    .where(and(inArray(ingredientsTable.id, ids), eq(ingredientsTable.archived, false)));
  return activeIngredients.length === ids.length
    ? null
    : "Tarifte arşivlenmiş veya bulunamayan bir stok malzemesi var.";
}

async function getAdminMenuItem(id: number) {
  const [item] = await db
    .select()
    .from(menuItemsTable)
    .where(eq(menuItemsTable.id, id))
    .limit(1);
  if (!item) return null;

  const recipe = await db
    .select({
      ingredientId: ingredientsTable.id,
      ingredientName: ingredientsTable.name,
      quantity: recipeIngredientsTable.quantity,
      unit: ingredientsTable.unit,
    })
    .from(recipeIngredientsTable)
    .innerJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.menuItemId, id))
    .orderBy(ingredientsTable.name);

  return {
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    price: Number(item.price),
    available: item.available,
    publicIngredients: item.publicIngredients,
    allergens: item.allergens,
    kitchenInstructions: item.kitchenInstructions,
    archived: item.archived,
    recipe,
  };
}

router.get(
  "/admin/categories",
  requireCafeUser(["admin"]),
  async (_req, res): Promise<void> => {
    // Bring existing string-based menu categories into the editable global category list.
    const legacyNames = await db
      .selectDistinct({ name: menuItemsTable.category })
      .from(menuItemsTable)
      .orderBy(menuItemsTable.category);
    for (const { name } of legacyNames) await ensureGlobalCategory(name);

    const categories = await db
      .select()
      .from(menuCategoriesTable)
      .where(isNull(menuCategoriesTable.branchId))
      .orderBy(menuCategoriesTable.name);
    res.json(ListAdminCategoriesResponse.parse(categories));
  },
);

router.post(
  "/admin/categories",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const parsed = CreateAdminCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const name = parsed.data.name.trim();
    const existing = await db
      .select({ id: menuCategoriesTable.id })
      .from(menuCategoriesTable)
      .where(and(isNull(menuCategoriesTable.branchId), eq(menuCategoriesTable.name, name)))
      .limit(1);
    if (existing.length) {
      res.status(409).json({ error: "Bu kategori zaten mevcut." });
      return;
    }

    const [category] = await db
      .insert(menuCategoriesTable)
      .values({ name, branchId: null })
      .returning();
    res.status(201).json(CreateAdminCategoryResponse.parse(category));
  },
);

router.patch(
  "/admin/categories/:id",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const params = UpdateAdminCategoryParams.safeParse(req.params);
    const parsed = UpdateAdminCategoryBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: params.error?.message ?? parsed.error?.message });
      return;
    }
    const [current] = await db
      .select()
      .from(menuCategoriesTable)
      .where(and(eq(menuCategoriesTable.id, params.data.id), isNull(menuCategoriesTable.branchId)))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Kategori bulunamadı." });
      return;
    }
    const newName = parsed.data.name?.trim();
    const updated = await db.transaction(async (tx) => {
      if (newName && newName !== current.name) {
        await tx
          .update(menuItemsTable)
          .set({ category: newName })
          .where(eq(menuItemsTable.category, current.name));
      }
      const [category] = await tx
        .update(menuCategoriesTable)
        .set({ ...parsed.data, ...(newName ? { name: newName } : {}), updatedAt: new Date() })
        .where(eq(menuCategoriesTable.id, current.id))
        .returning();
      return category;
    });
    res.json(UpdateAdminCategoryResponse.parse(updated));
  },
);

router.get(
  "/admin/ingredients",
  requireCafeUser(["admin"]),
  async (_req, res): Promise<void> => {
    const ingredients = await db.select().from(ingredientsTable).orderBy(ingredientsTable.name);
    res.json(ListAdminIngredientsResponse.parse(ingredients));
  },
);

router.post(
  "/admin/ingredients",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const parsed = CreateAdminIngredientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select({ id: ingredientsTable.id })
      .from(ingredientsTable)
      .where(eq(ingredientsTable.name, parsed.data.name.trim()))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Bu malzeme zaten kayıtlı." });
      return;
    }
    const [ingredient] = await db
      .insert(ingredientsTable)
      .values({ name: parsed.data.name.trim(), unit: parsed.data.unit.trim() })
      .returning();
    res.status(201).json(CreateAdminIngredientResponse.parse(ingredient));
  },
);

router.patch(
  "/admin/ingredients/:id",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const params = UpdateAdminIngredientParams.safeParse(req.params);
    const parsed = UpdateAdminIngredientBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: params.error?.message ?? parsed.error?.message });
      return;
    }
    const [ingredient] = await db
      .update(ingredientsTable)
      .set({
        ...parsed.data,
        ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.unit ? { unit: parsed.data.unit.trim() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(ingredientsTable.id, params.data.id))
      .returning();
    if (!ingredient) {
      res.status(404).json({ error: "Malzeme bulunamadı." });
      return;
    }
    res.json(UpdateAdminIngredientResponse.parse(ingredient));
  },
);

router.get(
  "/admin/menu-items",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const params = ListAdminMenuItemsQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const clauses = [];
    if (!params.data.includeArchived) clauses.push(eq(menuItemsTable.archived, false));
    if (params.data.search?.trim()) {
      const pattern = `%${params.data.search.trim()}%`;
      clauses.push(
        or(
          ilike(menuItemsTable.name, pattern),
          ilike(menuItemsTable.description, pattern),
          ilike(menuItemsTable.category, pattern),
        )!,
      );
    }
    const items = await db
      .select({ id: menuItemsTable.id })
      .from(menuItemsTable)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(menuItemsTable.createdAt));
    const catalog = await Promise.all(items.map((item) => getAdminMenuItem(item.id)));
    res.json(ListAdminMenuItemsResponse.parse(catalog.filter(Boolean)));
  },
);

router.post(
  "/admin/menu-items",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const parsed = CreateAdminMenuItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const recipeError = await validateRecipe(parsed.data.recipe);
    if (recipeError) {
      res.status(400).json({ error: recipeError });
      return;
    }
    const data = parsed.data;
    await ensureGlobalCategory(data.category.trim());

    const itemId = await db.transaction(async (tx) => {
      const [item] = await tx
        .insert(menuItemsTable)
        .values({
          name: data.name.trim(),
          description: data.description.trim(),
          category: data.category.trim(),
          price: data.price,
          available: true,
          publicIngredients: data.publicIngredients,
          allergens: data.allergens,
          kitchenInstructions: data.kitchenInstructions.trim(),
        })
        .returning({ id: menuItemsTable.id });
      if (data.recipe.length) {
        await tx.insert(recipeIngredientsTable).values(
          data.recipe.map((entry) => ({
            menuItemId: item.id,
            ingredientId: entry.ingredientId,
            quantity: entry.quantity,
          })),
        );
      }
      return item.id;
    });

    const result = await getAdminMenuItem(itemId);
    res.status(201).json(CreateAdminMenuItemResponse.parse(result));
  },
);

router.patch(
  "/admin/menu-items/:id",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const params = UpdateAdminMenuItemParams.safeParse(req.params);
    const parsed = UpdateAdminMenuItemBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: params.error?.message ?? parsed.error?.message });
      return;
    }
    const [current] = await db
      .select()
      .from(menuItemsTable)
      .where(eq(menuItemsTable.id, params.data.id))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Ürün bulunamadı." });
      return;
    }
    if (parsed.data.recipe) {
      const recipeError = await validateRecipe(parsed.data.recipe);
      if (recipeError) {
        res.status(400).json({ error: recipeError });
        return;
      }
    }
    if (parsed.data.category?.trim()) await ensureGlobalCategory(parsed.data.category.trim());

    await db.transaction(async (tx) => {
      const { recipe, ...fields } = parsed.data;
      await tx
        .update(menuItemsTable)
        .set({
          ...fields,
          ...(fields.name ? { name: fields.name.trim() } : {}),
          ...(fields.description ? { description: fields.description.trim() } : {}),
          ...(fields.category ? { category: fields.category.trim() } : {}),
          ...(fields.kitchenInstructions
            ? { kitchenInstructions: fields.kitchenInstructions.trim() }
            : {}),
          ...(fields.price !== undefined ? { price: fields.price } : {}),
          updatedAt: new Date(),
        })
        .where(eq(menuItemsTable.id, current.id));

      if (recipe) {
        await tx
          .delete(recipeIngredientsTable)
          .where(eq(recipeIngredientsTable.menuItemId, current.id));
        if (recipe.length) {
          await tx.insert(recipeIngredientsTable).values(
            recipe.map((entry) => ({
              menuItemId: current.id,
              ingredientId: entry.ingredientId,
              quantity: entry.quantity,
            })),
          );
        }
      }
    });

    const result = await getAdminMenuItem(current.id);
    res.json(UpdateAdminMenuItemResponse.parse(result));
  },
);

export default router;
