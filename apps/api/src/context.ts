import type { ApiKey, Db, Membership, Team, User } from "@worlds/db";
import type { AppSpec, CreatedApp } from "@worlds/slack/service";

export type WorldsControl = {
  purge(worldId: string): Promise<void>;
  setupSlack(worldId: string, apps: AppSpec[]): Promise<CreatedApp[]>;
};

export type Caller = { kind: "key"; key: ApiKey } | { kind: "user"; user: User };

export type AppEnv = {
  Bindings: { DB: D1Database; SLACK: WorldsControl; WORLDS_DOMAIN: string };
  Variables: { db: Db; caller: Caller };
};

export type TeamAccess = { team: Team; role: Membership["role"] | null };

export function apiError(code: string, message: string) {
  return { error: { code, message } };
}
