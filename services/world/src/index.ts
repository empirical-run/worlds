import { apiError } from "@worlds/contract";
import { database, liveWorld, parseWorldHost } from "@worlds/db";
import { resolveHost, type WorldSpecs, type WorldStates } from "@worlds/services";
import { HOSTING } from "@worlds/services/hosting";
import { WorkerEntrypoint } from "cloudflare:workers";

import { canControl } from "./access";
import { signInPage, withBanner } from "./banner";
import type { Env } from "./env";
import { HOST_HEADER, WORLD_ID_HEADER } from "./world";

export { World } from "./world";

const CONTROL_PATHS = ["/_worlds/", "/_inspector"];

export class WorldsControl extends WorkerEntrypoint<Env> {
  async archive(worldId: string): Promise<void> {
    await this.world(worldId).archive();
  }

  async setup(worldId: string, specs: WorldSpecs): Promise<WorldStates> {
    return this.world(worldId).setup(worldId, specs);
  }

  async states(worldId: string): Promise<WorldStates> {
    return this.world(worldId).states();
  }

  private world(worldId: string) {
    return this.env.WORLD.get(this.env.WORLD.idFromName(worldId));
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const target = parseWorldHost(url.hostname, env.WORLDS_DOMAIN);
    if (!target) return Response.redirect(`${env.MAKEWORLDS_URL}/account`, 302);
    const resolved = resolveHost(target.service);
    if (!resolved) return slackError(404, "unknown_service");
    const { service, host } = resolved;
    if (url.pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);
    const db = database(env.DB);
    const world = await liveWorld(db, target.worldId);
    if (!world) return slackError(404, "world_not_found");

    const banner = (response: Response) =>
      withBanner(response, service.title, world, env.MAKEWORLDS_URL);
    const page = HOSTING[service.name].page(request, url, host);
    if (page === "members-only" && !(await canControl(request, db, world)))
      return banner(signInPage(service.title, world, env.MAKEWORLDS_URL));
    if (page === "ui")
      return banner(await env.ASSETS.fetch(new Request(new URL("/", url), request)));
    if (
      CONTROL_PATHS.some((prefix) => url.pathname.startsWith(prefix)) &&
      !(await canControl(request, db, world))
    ) {
      return Response.json(
        apiError(
          "unauthorized",
          "Send your team's API key as Authorization: Bearer <key>, or sign in.",
        ),
        { status: 401 },
      );
    }

    const forwarded = new Request(request);
    forwarded.headers.set(HOST_HEADER, host);
    forwarded.headers.set(WORLD_ID_HEADER, world.id);
    return banner(await env.WORLD.get(env.WORLD.idFromName(world.id)).fetch(forwarded));
  },
} satisfies ExportedHandler<Env>;

function slackError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}
