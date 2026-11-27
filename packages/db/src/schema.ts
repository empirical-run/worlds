import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { newId } from "./ids";

const timestamps = () => ({
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => newId("user")),
  email: text("email").notNull(),
  name: text("name"),
  picture: text("picture"),
  ...timestamps(),
});

export const identities = sqliteTable(
  "identities",
  {
    provider: text("provider", { enum: ["google", "github"] }).notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.subject] }), index("identities_user_id_idx").on(table.userId)],
);

export const teams = sqliteTable("teams", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => newId("team")),
  name: text("name").notNull(),
  ...timestamps(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] }), index("memberships_user_id_idx").on(table.userId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("apiKey")),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    ...timestamps(),
  },
  (table) => [index("api_keys_team_id_idx").on(table.teamId)],
);

export const worlds = sqliteTable(
  "worlds",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("world")),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    ...timestamps(),
  },
  (table) => [index("worlds_team_id_idx").on(table.teamId)],
);

export type User = typeof users.$inferSelect;
export type World = typeof worlds.$inferSelect;
export type Provider = (typeof identities.$inferSelect)["provider"];
export type ApiKey = typeof apiKeys.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
