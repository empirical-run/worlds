import { database, liveWorld } from "@worlds/db";
import { WorkerEntrypoint } from "cloudflare:workers";
import { canControl } from "./access";
import type { Env } from "./env";
import { BASE_URL_HEADER, SERVICE_HEADER } from "./world";

export { World } from "./world";

const WORLD_PATH = /^\/w\/(world_[a-z0-9]+)(\/.*)?$/;
const CONTROL_PATHS = ["/_worlds/", "/_inspector"];

export class WorldsControl extends WorkerEntrypoint<Env> {
  async purge(worldId: string): Promise<void> {
    await this.env.WORLD.get(this.env.WORLD.idFromName(worldId)).purge();
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);
    const match = WORLD_PATH.exec(url.pathname);
    if (!match?.[1]) {
      if (url.pathname === "/") return Response.redirect(`${env.MAKEWORLDS_URL}/account`, 302);
      return slackError(404, "world_not_found");
    }
    const [, worldId, rest = ""] = match;
    if (!rest) return Response.redirect(`${url.origin}/w/${worldId}/${url.search}`, 301);
    const db = database(env.DB);
    const world = await liveWorld(db, worldId);
    if (!world) return slackError(404, "world_not_found");

    if (request.method === "GET" && (rest === "/" || rest === "/index.html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    if (CONTROL_PATHS.some((prefix) => rest.startsWith(prefix)) && !(await canControl(request, db, world))) {
      return slackError(401, "not_authed");
    }

    const forwarded = new Request(new URL(`${rest}${url.search}`, url), request);
    forwarded.headers.set(SERVICE_HEADER, "slack");
    forwarded.headers.set(BASE_URL_HEADER, `${env.WORLDS_SLACK_URL || url.origin}/w/${worldId}`);
    return env.WORLD.get(env.WORLD.idFromName(worldId)).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

function slackError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}
