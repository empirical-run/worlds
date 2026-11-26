import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { randomToken, sha256 } from "./crypto";
import type { GoogleProfile } from "./google";
import { apiKeys, sessions, users, type ApiKey, type User } from "./schema";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const API_KEY_PREFIX = "wk_";

export type Db = ReturnType<typeof database>;

export function database(d1: D1Database) {
  return drizzle(d1, { schema: { users, sessions, apiKeys } });
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
  return user;
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

export async function listKeys(db: Db, userId: string): Promise<ApiKey[]> {
  return db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

export async function createKey(db: Db, userId: string, name: string): Promise<string> {
  const key = `${API_KEY_PREFIX}${randomToken()}`;
  await db.insert(apiKeys).values({
    id: crypto.randomUUID(),
    userId,
    name,
    keyHash: await sha256(key),
    prefix: key.slice(0, API_KEY_PREFIX.length + 6),
  });
  return key;
}

export async function revokeKey(db: Db, userId: string, keyId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
}
