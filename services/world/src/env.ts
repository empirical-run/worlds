import type { World } from "./world";

export type Env = {
  WORLD: DurableObjectNamespace<World>;
  ASSETS: Fetcher;
  DB: D1Database;
  WORLDS_DOMAIN: string;
  WORLDS_SCHEME: string;
  WORLDS_PORT: string;
  MAKEWORLDS_URL: string;
};
