import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { randomToken, sha256 } from "./crypto";
import type { GoogleProfile } from "./google";
import { apiKeys, memberships, sessions, teams, users, type ApiKey, type Team, type User } from "./schema";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const API_KEY_PREFIX = "wk_";

export type Db = ReturnType<typeof database>;

export function database(d1: D1Database) {
  return drizzle(d1, { schema: { users, teams, memberships, sessions, apiKeys } });
}

export async function upsertUser(db: Db, profile: GoogleProfile): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ id: crypto.randomUUID(), googleSub: profile.sub, email: profile.email, name: profile.name, picture: profile.picture })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: { email: profile.email, name: profile.name, picture: profile.picture },
    })
    .returning();
  if (!user) throw new Error("upsert returned no user");
  await ensurePersonalTeam(db, user);
  return user;
}

async function ensurePersonalTeam(db: Db, user: User): Promise<void> {
  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (membership) return;
  const teamId = crypto.randomUUID();
  await db.batch([
    db.insert(teams).values({ id: teamId, name: user.name ?? user.email }),
    db.insert(memberships).values({ teamId, userId: user.id, role: "owner" }),
  ]);
}

export async function teamForUser(db: Db, userId: string): Promise<Team> {
  const [row] = await db
    .select({ team: teams })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  if (!row) throw new Error(`user ${userId} has no team`);
  return row.team;
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomToken();
  await db.insert(sessions).values({
    tokenHash: await sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function userForSession(db: Db, token: string): Promise<User | null> {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, await sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
}

export async function listKeys(db: Db, teamId: string): Promise<ApiKey[]> {
  return db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.teamId, teamId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

export async function createKey(db: Db, teamId: string, createdBy: string, name: string): Promise<string> {
  const key = `${API_KEY_PREFIX}${randomToken()}`;
  await db.insert(apiKeys).values({
    id: crypto.randomUUID(),
    teamId,
    createdBy,
    name,
    keyHash: await sha256(key),
    prefix: key.slice(0, API_KEY_PREFIX.length + 6),
  });
  return key;
}

export async function revokeKey(db: Db, teamId: string, keyId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.teamId, teamId), isNull(apiKeys.revokedAt)));
}
