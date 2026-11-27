import { database, liveWorld, parseWorldHost } from "@worlds/db";
import { WorkerEntrypoint } from "cloudflare:workers";
import { canControl } from "./access";
import type { Env } from "./env";
import { BASE_URL_HEADER, SERVICE_HEADER } from "./world";

export { World } from "./world";

const SERVICES = ["slack"] as const;
const CONTROL_PATHS = ["/_worlds/", "/_inspector"];

export class WorldsControl extends WorkerEntrypoint<Env> {
  async purge(worldId: string): Promise<void> {
    await this.env.WORLD.get(this.env.WORLD.idFromName(worldId)).purge();
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

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    if (CONTROL_PATHS.some((prefix) => url.pathname.startsWith(prefix)) && !(await canControl(request, db, world))) {
      return slackError(401, "not_authed");
    }

    const forwarded = new Request(request);
    forwarded.headers.set(SERVICE_HEADER, target.service);
    forwarded.headers.set(BASE_URL_HEADER, url.origin);
    return env.WORLD.get(env.WORLD.idFromName(world.id)).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

function isService(value: string): value is (typeof SERVICES)[number] {
  return SERVICES.some((service) => service === value);
}

function slackError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}
