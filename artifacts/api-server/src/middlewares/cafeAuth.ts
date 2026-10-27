import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  appUsersTable,
  branchesTable,
  db,
  type AppUser,
} from "@workspace/db";
import {
  FirebaseTokenError,
  verifyFirebaseIdToken,
  type FirebaseIdentity,
} from "./firebaseToken";

export type CafeRole = AppUser["role"];

export class CafeAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function getFullName(name: string | null, email: string, existingName?: string): string {
  return name || existingName?.trim() || email.split("@")[0] || "Café Verün müşterisi";
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
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new CafeAuthError(401, "Giriş yapmanız gerekiyor.");

  let identity: FirebaseIdentity;
  try {
    identity = await verifyFirebaseIdToken(token);
  } catch (error) {
    if (error instanceof FirebaseTokenError) {
      throw new CafeAuthError(error.status, error.message);
    }
    throw error;
  }

  const { uid, email } = identity;
  const bootstrapAdmin = await getAdminBootstrapRole(email);
  const [byFirebaseUid] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.firebaseUid, uid))
    .limit(1);

  if (byFirebaseUid) {
    const [emailOwner] = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(eq(appUsersTable.email, email))
      .limit(1);
    if (emailOwner && emailOwner.id !== byFirebaseUid.id) {
      throw new CafeAuthError(409, "Bu e-posta başka bir Café Verün hesabına bağlı.");
    }
    const [updated] = await db
      .update(appUsersTable)
      .set({
        email,
        fullName: getFullName(identity.name, email, byFirebaseUid.fullName),
        status: "active",
        ...(bootstrapAdmin ? { role: "admin" as const } : {}),
      })
      .where(eq(appUsersTable.id, byFirebaseUid.id))
      .returning();
    return updated ?? byFirebaseUid;
  }

  const [byEmail] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email))
    .limit(1);

  if (byEmail) {
    if (byEmail.firebaseUid && byEmail.firebaseUid !== uid) {
      throw new CafeAuthError(409, "Bu e-posta başka bir Café Verün hesabına bağlı.");
    }
    const [linked] = await db
      .update(appUsersTable)
      .set({
        firebaseUid: uid,
        fullName: getFullName(identity.name, email, byEmail.fullName),
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
      firebaseUid: uid,
      email,
      fullName: getFullName(identity.name, email),
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
      if (
        user.role === "branch_manager" || user.role === "cashier" || user.role === "kitchen"
      ) {
        const [branch] = await db
          .select({ id: branchesTable.id })
          .from(branchesTable)
          .where(and(eq(branchesTable.id, user.branchId!), eq(branchesTable.active, true)))
          .limit(1);
        if (!branch) {
          res.status(403).json({ error: "Hesabınızın şubesi kapalı veya devre dışı." });
          return;
        }
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
