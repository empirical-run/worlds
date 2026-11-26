import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { randomToken, sha256 } from "./crypto";
import {
  apiKeys,
  identities,
  memberships,
  sessions,
  teams,
  users,
  type ApiKey,
  type Provider,
  type Membership,
  type Team,
  type User,
} from "./schema";

export const TEAM_NAME_MAX = 80;

export type Profile = {
  provider: Provider;
  subject: string;
  email: string;
  name: string | null;
  picture: string | null;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const API_KEY_PREFIX = "wk_";

export type Db = ReturnType<typeof database>;

export function database(d1: D1Database) {
  return drizzle(d1, { schema: { users, identities, teams, memberships, sessions, apiKeys } });
}

export async function signIn(db: Db, profile: Profile): Promise<User> {
  const details = { email: profile.email, name: profile.name, picture: profile.picture };
  const [linked] = await db
    .select({ user: users })
    .from(identities)
    .innerJoin(users, eq(users.id, identities.userId))
    .where(and(eq(identities.provider, profile.provider), eq(identities.subject, profile.subject)))
    .limit(1);
  if (linked) {
    const [user] = await db.update(users).set(details).where(eq(users.id, linked.user.id)).returning();
    return user ?? linked.user;
  }

  const identity = { provider: profile.provider, subject: profile.subject };
  const [sameEmail] = await db.select().from(users).where(eq(users.email, profile.email)).orderBy(asc(users.createdAt)).limit(1);
  if (sameEmail) {
    await db.insert(identities).values({ ...identity, userId: sameEmail.id });
    return sameEmail;
  }

  const userId = crypto.randomUUID();
  const teamId = crypto.randomUUID();
  const [[user]] = await db.batch([
    db.insert(users).values({ id: userId, ...details }).returning(),
    db.insert(identities).values({ ...identity, userId }),
    db.insert(teams).values({ id: teamId, name: profile.name ?? profile.email }),
    db.insert(memberships).values({ teamId, userId, role: "owner" }),
  ]);
  if (!user) throw new Error("user insert returned no row");
  return user;
}

export type TeamMembership = { team: Team; role: Membership["role"] };

export async function teamsForUser(db: Db, userId: string): Promise<TeamMembership[]> {
  return db
    .select({ team: teams, role: memberships.role })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}

export async function teamById(db: Db, teamId: string): Promise<Team | null> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return team ?? null;
}

export async function membersOf(db: Db, teamId: string) {
  return db
    .select({ user: users, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.teamId, teamId))
    .orderBy(asc(memberships.createdAt));
}

export async function useKey(db: Db, key: string): Promise<ApiKey | null> {
  const [apiKey] = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.keyHash, await sha256(key)), isNull(apiKeys.revokedAt)))
    .returning();
  return apiKey ?? null;
}

export async function teamForUser(db: Db, userId: string): Promise<TeamMembership> {
  const [row] = await db
    .select({ team: teams, role: memberships.role })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  if (!row) throw new Error(`user ${userId} has no team`);
  return row;
}

export async function renameTeam(db: Db, teamId: string, name: string): Promise<void> {
  await db.update(teams).set({ name }).where(eq(teams.id, teamId));
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
