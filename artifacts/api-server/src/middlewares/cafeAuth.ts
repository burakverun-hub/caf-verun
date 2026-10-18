import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  appUsersTable,
  branchesTable,
  db,
  type AppUser,
} from "@workspace/db";

export type CafeRole = AppUser["role"];

export class CafeAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function getFullName(firstName?: string | null, lastName?: string | null, email?: string): string {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || email?.split("@")[0] || "Café Verün müşterisi";
}

async function getAdminBootstrapRole(email: string): Promise<boolean> {
  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (!bootstrapEmail || bootstrapEmail !== email) return false;

  const [existingAdmin] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(eq(appUsersTable.role, "admin"))
    .limit(1);
  return !existingAdmin;
}

export async function ensureCafeUser(req: Request): Promise<AppUser> {
  const { userId } = getAuth(req);
  if (!userId) throw new CafeAuthError(401, "Giriş yapmanız gerekiyor.");

  const clerkUser = await clerkClient.users.getUser(userId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ||
    clerkUser.emailAddresses[0]?.emailAddress?.trim().toLowerCase();
  if (!email) throw new CafeAuthError(403, "Hesabınızda doğrulanmış bir e-posta bulunamadı.");

  const fullName = getFullName(clerkUser.firstName, clerkUser.lastName, email);
  const bootstrapAdmin = await getAdminBootstrapRole(email);
  const [byClerkId] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, userId))
    .limit(1);

  if (byClerkId) {
    const [updated] = await db
      .update(appUsersTable)
      .set({
        email,
        fullName,
        status: "active",
        ...(bootstrapAdmin ? { role: "admin" as const } : {}),
      })
      .where(eq(appUsersTable.id, byClerkId.id))
      .returning();
    return updated ?? byClerkId;
  }

  const [byEmail] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email))
    .limit(1);

  if (byEmail) {
    if (byEmail.clerkUserId && byEmail.clerkUserId !== userId) {
      throw new CafeAuthError(409, "Bu e-posta başka bir Café Verün hesabına bağlı.");
    }
    const [linked] = await db
      .update(appUsersTable)
      .set({
        clerkUserId: userId,
        fullName,
        status: "active",
        ...(bootstrapAdmin ? { role: "admin" as const } : {}),
      })
      .where(eq(appUsersTable.id, byEmail.id))
      .returning();
    return linked ?? byEmail;
  }

  const [created] = await db
    .insert(appUsersTable)
    .values({
      clerkUserId: userId,
      email,
      fullName,
      role: bootstrapAdmin ? "admin" : "customer",
      status: "active",
    })
    .returning();
  return created;
}

export function requireCafeUser(roles?: CafeRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await ensureCafeUser(req);
      if (!user.active) {
        res.status(403).json({ error: "Hesabınız devre dışı bırakılmış." });
        return;
      }
      if (roles && !roles.includes(user.role)) {
        res.status(403).json({ error: "Bu işlem için yetkiniz yok." });
        return;
      }
      if (
        (user.role === "branch_manager" || user.role === "cashier" || user.role === "kitchen") &&
        user.branchId === null
      ) {
        res.status(403).json({ error: "Hesabınıza henüz bir şube atanmamış." });
        return;
      }

      res.locals.cafeUser = user;
      next();
    } catch (error) {
      if (error instanceof CafeAuthError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log?.error({ err: error }, "Failed to authenticate Café Verün user");
      res.status(500).json({ error: "Hesap doğrulanırken bir hata oluştu." });
    }
  };
}

export function getCafeUser(res: Response): AppUser {
  const user = res.locals.cafeUser as AppUser | undefined;
  if (!user) throw new Error("Cafe user middleware was not applied");
  return user;
}

export async function userProfile(user: AppUser) {
  const [branch] = user.branchId
    ? await db
        .select({ name: branchesTable.name })
        .from(branchesTable)
        .where(and(eq(branchesTable.id, user.branchId), eq(branchesTable.active, true)))
        .limit(1)
    : [];

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    branchId: user.branchId,
    branchName: branch?.name ?? null,
    staffCode: user.staffCode,
    active: user.active,
  };
}
