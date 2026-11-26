import type { ApiKey, Db, Membership, Team, User } from "@worlds/db";

export type Caller = { kind: "key"; key: ApiKey } | { kind: "user"; user: User };

export type AppEnv = {
  Bindings: { DB: D1Database };
  Variables: { db: Db; caller: Caller };
};

export type TeamAccess = { team: Team; role: Membership["role"] | null };

export function apiError(code: string, message: string) {
  return { error: { code, message } };
}
