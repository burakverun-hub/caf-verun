import { boolean, index, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";

export const appUserRoleEnum = pgEnum("app_user_role", [
  "customer",
  "admin",
  "branch_manager",
  "cashier",
  "kitchen",
]);

export const appUserStatusEnum = pgEnum("app_user_status", ["invited", "active"]);

export const appUsersTable = pgTable(
  "app_users",
  {
    id: serial("id").primaryKey(),
    legacyClerkUserId: text("clerk_user_id"),
    firebaseUid: text("firebase_uid"),
    email: text("email").notNull(),
    fullName: text("full_name").notNull().default(""),
    role: appUserRoleEnum("role").notNull().default("customer"),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    staffCode: text("staff_code"),
    status: appUserStatusEnum("status").notNull().default("active"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("app_users_clerk_id_unique").on(table.legacyClerkUserId),
    uniqueIndex("app_users_firebase_uid_unique").on(table.firebaseUid),
    uniqueIndex("app_users_email_unique").on(table.email),
    uniqueIndex("app_users_staff_code_unique").on(table.staffCode),
    index("app_users_branch_role_active_idx").on(table.branchId, table.role, table.active),
  ],
);

export type AppUser = typeof appUsersTable.$inferSelect;
export type InsertAppUser = typeof appUsersTable.$inferInsert;
