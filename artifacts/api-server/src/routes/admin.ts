import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import {
  CreateAdminBranchBody,
  CreateAdminBranchResponse,
  CreateAdminStaffBody,
  CreateAdminStaffResponse,
  ListAdminBranchesResponse,
  ListAdminStaffQueryParams,
  ListAdminStaffResponse,
  UpdateAdminBranchBody,
  UpdateAdminBranchParams,
  UpdateAdminBranchResponse,
  UpdateAdminStaffBody,
  UpdateAdminStaffParams,
  UpdateAdminStaffResponse,
} from "@workspace/api-zod";
import { appUsersTable, branchesTable, db } from "@workspace/db";
import { requireCafeUser } from "../middlewares/cafeAuth";

const router: IRouter = Router();
const staffRoles = ["branch_manager", "cashier", "kitchen"] as const;
type StaffRole = (typeof staffRoles)[number];

function branchResponse(branch: typeof branchesTable.$inferSelect) {
  return { ...branch, createdAt: branch.createdAt.toISOString() };
}

function staffResponse(
  user: typeof appUsersTable.$inferSelect,
  branchName: string | null,
) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    branchId: user.branchId,
    branchName,
    staffCode: user.staffCode,
    active: user.active,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/admin/branches", requireCafeUser(["admin"]), async (_req, res): Promise<void> => {
  const branches = await db.select().from(branchesTable).orderBy(branchesTable.name);
  res.json(ListAdminBranchesResponse.parse(branches.map(branchResponse)));
});

router.post("/admin/branches", requireCafeUser(["admin"]), async (req, res): Promise<void> => {
  const parsed = CreateAdminBranchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const branch = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(branchesTable)
      .values({
        code: `CV-SB-PENDING-${randomUUID()}`,
        name: parsed.data.name.trim(),
        address: parsed.data.address.trim(),
        phone: parsed.data.phone.trim(),
      })
      .returning();
    const [withCode] = await tx
      .update(branchesTable)
      .set({ code: `CV-SB-${String(created.id).padStart(3, "0")}` })
      .where(eq(branchesTable.id, created.id))
      .returning();
    return withCode;
  });

  res.status(201).json(CreateAdminBranchResponse.parse(branchResponse(branch)));
});

router.patch(
  "/admin/branches/:id",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const params = UpdateAdminBranchParams.safeParse(req.params);
    const parsed = UpdateAdminBranchBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: params.error?.message ?? parsed.error?.message });
      return;
    }

    const [branch] = await db
      .update(branchesTable)
      .set({
        ...parsed.data,
        ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.address ? { address: parsed.data.address.trim() } : {}),
        ...(parsed.data.phone ? { phone: parsed.data.phone.trim() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(branchesTable.id, params.data.id))
      .returning();
    if (!branch) {
      res.status(404).json({ error: "Şube bulunamadı." });
      return;
    }
    res.json(UpdateAdminBranchResponse.parse(branchResponse(branch)));
  },
);

router.get("/admin/staff", requireCafeUser(["admin"]), async (req, res): Promise<void> => {
  const params = ListAdminStaffQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const clauses = [
    ne(appUsersTable.role, "customer"),
    ne(appUsersTable.role, "admin"),
  ];
  if (params.data.role) clauses.push(eq(appUsersTable.role, params.data.role));
  if (params.data.search?.trim()) {
    const search = `%${params.data.search.trim()}%`;
    clauses.push(
      or(
        ilike(appUsersTable.fullName, search),
        ilike(appUsersTable.email, search),
        ilike(appUsersTable.staffCode, search),
      )!,
    );
  }

  const staff = await db
    .select({ user: appUsersTable, branchName: branchesTable.name })
    .from(appUsersTable)
    .leftJoin(branchesTable, eq(appUsersTable.branchId, branchesTable.id))
    .where(and(...clauses))
    .orderBy(desc(appUsersTable.createdAt));

  res.json(
    ListAdminStaffResponse.parse(
      staff.map(({ user, branchName }) => staffResponse(user, branchName)),
    ),
  );
});

router.post("/admin/staff", requireCafeUser(["admin"]), async (req, res): Promise<void> => {
  const parsed = CreateAdminStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const fullName = parsed.data.fullName.trim();
  const role = parsed.data.role as StaffRole;

  const [branch] = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(eq(branchesTable.id, parsed.data.branchId), eq(branchesTable.active, true)))
    .limit(1);
  if (!branch) {
    res.status(400).json({ error: "Aktif bir şube seçin." });
    return;
  }

  const [existing] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email))
    .limit(1);
  if (existing && existing.role !== "customer") {
    res.status(409).json({ error: "Bu e-posta için bir personel hesabı zaten var." });
    return;
  }

  const saved = await db.transaction(async (tx) => {
    let user: typeof appUsersTable.$inferSelect;
    if (existing) {
      const [updated] = await tx
        .update(appUsersTable)
        .set({
          fullName,
          role,
          branchId: parsed.data.branchId,
          status: existing.firebaseUid ? "active" : "invited",
          active: true,
        })
        .where(eq(appUsersTable.id, existing.id))
        .returning();
      user = updated;
    } else {
      const [created] = await tx
        .insert(appUsersTable)
        .values({
          email,
          fullName,
          role,
          branchId: parsed.data.branchId,
          status: "invited",
        })
        .returning();
      user = created;
    }

    if (role === "cashier" && !user.staffCode) {
      const [withCode] = await tx
        .update(appUsersTable)
        .set({ staffCode: `CV-KS-${String(user.id).padStart(5, "0")}` })
        .where(eq(appUsersTable.id, user.id))
        .returning();
      user = withCode;
    }
    return user;
  });

  const [assignedBranch] = await db
    .select({ name: branchesTable.name })
    .from(branchesTable)
    .where(eq(branchesTable.id, saved.branchId!))
    .limit(1);
  res.status(201).json(
    CreateAdminStaffResponse.parse(staffResponse(saved, assignedBranch?.name ?? null)),
  );
});

router.patch(
  "/admin/staff/:id",
  requireCafeUser(["admin"]),
  async (req, res): Promise<void> => {
    const params = UpdateAdminStaffParams.safeParse(req.params);
    const parsed = UpdateAdminStaffBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: params.error?.message ?? parsed.error?.message });
      return;
    }

    const [current] = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.id, params.data.id))
      .limit(1);
    if (!current || !staffRoles.includes(current.role as StaffRole)) {
      res.status(404).json({ error: "Personel hesabı bulunamadı." });
      return;
    }

    if (
      parsed.data.branchId !== undefined &&
      parsed.data.branchId !== null
    ) {
      const [branch] = await db
        .select({ id: branchesTable.id })
        .from(branchesTable)
        .where(and(eq(branchesTable.id, parsed.data.branchId), eq(branchesTable.active, true)))
        .limit(1);
      if (!branch) {
        res.status(400).json({ error: "Aktif bir şube seçin." });
        return;
      }
    }
    if (parsed.data.role && !staffRoles.includes(parsed.data.role as StaffRole)) {
      res.status(400).json({ error: "Geçerli bir personel rolü seçin." });
      return;
    }

    const updated = await db.transaction(async (tx) => {
      let [user] = await tx
        .update(appUsersTable)
        .set({
          ...parsed.data,
          ...(parsed.data.fullName ? { fullName: parsed.data.fullName.trim() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(appUsersTable.id, current.id))
        .returning();
      if (user.role === "cashier" && !user.staffCode) {
        [user] = await tx
          .update(appUsersTable)
          .set({ staffCode: `CV-KS-${String(user.id).padStart(5, "0")}` })
          .where(eq(appUsersTable.id, user.id))
          .returning();
      }
      return user;
    });
    const [branch] = updated.branchId
      ? await db
          .select({ name: branchesTable.name })
          .from(branchesTable)
          .where(eq(branchesTable.id, updated.branchId))
          .limit(1)
      : [];
    res.json(UpdateAdminStaffResponse.parse(staffResponse(updated, branch?.name ?? null)));
  },
);

export default router;
