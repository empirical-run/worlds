import type { World } from "./world";

export type Env = {
  WORLD: DurableObjectNamespace<World>;
  ASSETS: Fetcher;
  DB: D1Database;
  SLACK_SIGNING_SECRET: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_USER_TOKEN: string;
  SLACK_REDIRECT_URIS: string;
  SLACK_EVENTS_URL: string;
  WORLDS_DOMAIN: string;
  MAKEWORLDS_URL: string;
};
