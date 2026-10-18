import { index, pgTable, serial, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";

export const branchesTable = pgTable(
  "branches",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("branches_code_unique").on(table.code),
    index("branches_active_name_idx").on(table.active, table.name),
  ],
);

export type Branch = typeof branchesTable.$inferSelect;
export type InsertBranch = typeof branchesTable.$inferInsert;
