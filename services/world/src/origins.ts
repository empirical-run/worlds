import { worldHost } from "@worlds/db";

import type { Env } from "./env";

export type Service = "slack" | "jira" | "jira-auth" | "jira-api";

export const SERVICES: readonly Service[] = ["slack", "jira", "jira-auth", "jira-api"];

export function serviceOrigin(env: Env, worldId: string, service: Service): string {
  return `${env.WORLDS_SCHEME}://${worldHost(worldId, service, env.WORLDS_DOMAIN)}${env.WORLDS_PORT ? `:${env.WORLDS_PORT}` : ""}`;
}

export function jiraOrigins(env: Env, worldId: string) {
  return {
    site: serviceOrigin(env, worldId, "jira"),
    auth: serviceOrigin(env, worldId, "jira-auth"),
    api: serviceOrigin(env, worldId, "jira-api"),
  };
}
