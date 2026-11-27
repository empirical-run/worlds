import { worldHost } from "@worlds/db";

import type { Env } from "./env";

export function serviceOrigin(env: Env, worldId: string, host: string): string {
  return `${env.WORLDS_SCHEME}://${worldHost(worldId, host, env.WORLDS_DOMAIN)}${env.WORLDS_PORT ? `:${env.WORLDS_PORT}` : ""}`;
}
