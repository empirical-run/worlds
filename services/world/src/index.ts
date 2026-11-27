import { database, liveWorld, parseWorldHost } from "@worlds/db";
import type { JiraSpec, JiraState } from "@worlds/jira/spec";
import type { SlackSpec, SlackState } from "@worlds/slack/spec";
import { WorkerEntrypoint } from "cloudflare:workers";
import { canControl } from "./access";
import type { Env } from "./env";
import { SERVICES, serviceOrigin, type Service } from "./origins";
import { BASE_URL_HEADER, SERVICE_HEADER, WORLD_ID_HEADER } from "./world";

export { World } from "./world";

const CONTROL_PATHS = ["/_worlds/", "/_inspector"];

export class WorldsControl extends WorkerEntrypoint<Env> {
  async archive(worldId: string): Promise<void> {
    await this.env.WORLD.get(this.env.WORLD.idFromName(worldId)).archive();
  }

  async setupSlack(worldId: string, spec: SlackSpec): Promise<SlackState> {
    return this.env.WORLD.get(this.env.WORLD.idFromName(worldId)).setupSlack(spec, serviceOrigin(this.env, worldId, "slack"));
  }

  async slackState(worldId: string): Promise<SlackState | null> {
    return this.env.WORLD.get(this.env.WORLD.idFromName(worldId)).slackState();
  }

  async setupJira(worldId: string, spec: JiraSpec): Promise<JiraState> {
    return this.env.WORLD.get(this.env.WORLD.idFromName(worldId)).setupJira(worldId, spec);
  }

  async jiraState(worldId: string): Promise<JiraState | null> {
    return this.env.WORLD.get(this.env.WORLD.idFromName(worldId)).jiraState();
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const target = parseWorldHost(url.hostname, env.WORLDS_DOMAIN);
    if (!target) return Response.redirect(`${env.MAKEWORLDS_URL}/account`, 302);
    if (!isService(target.service)) return slackError(404, "unknown_service");
    if (url.pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);
    const db = database(env.DB);
    const world = await liveWorld(db, target.worldId);
    if (!world) return slackError(404, "world_not_found");

    if (target.service === "jira" && isSitePage(url.pathname) && !(await canControl(request, db, world))) {
      return new Response(`Sign in at ${env.MAKEWORLDS_URL}/account with a member of this world's team to see its Jira site.`, { status: 401 });
    }
    if (target.service === "slack" && request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    if (CONTROL_PATHS.some((prefix) => url.pathname.startsWith(prefix)) && !(await canControl(request, db, world))) {
      return slackError(401, "not_authed");
    }

    const forwarded = new Request(request);
    forwarded.headers.set(SERVICE_HEADER, target.service);
    forwarded.headers.set(BASE_URL_HEADER, url.origin);
    forwarded.headers.set(WORLD_ID_HEADER, world.id);
    return env.WORLD.get(env.WORLD.idFromName(world.id)).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

function isService(value: string): value is Service {
  return SERVICES.some((service) => service === value);
}

function isSitePage(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/browse/");
}

function slackError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}
