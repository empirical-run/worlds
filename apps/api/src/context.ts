import type { ApiKey, Db, Membership, Team, User } from "@worlds/db";
import type { SlackSpec, SlackState } from "@worlds/slack/spec";

export type WorldsControl = {
  archive(worldId: string): Promise<void>;
  setupSlack(worldId: string, spec: SlackSpec): Promise<SlackState>;
  slackState(worldId: string): Promise<SlackState | null>;
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
