import type { ApiKey, Db, Membership, Team, User } from "@worlds/db";
import type { WorldSpecs, WorldStates } from "@worlds/services";

export type WorldsControl = {
  archive(worldId: string): Promise<void>;
  setup(worldId: string, specs: WorldSpecs): Promise<WorldStates>;
  states(worldId: string): Promise<WorldStates>;
};

export type Caller = { kind: "key"; key: ApiKey } | { kind: "user"; user: User };

export type AppEnv = {
  Bindings: { DB: D1Database; WORLDS: WorldsControl; WORLDS_DOMAIN: string };
  Variables: { db: Db; caller: Caller };
};

export type TeamAccess = { team: Team; role: Membership["role"] | null };
