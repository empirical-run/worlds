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

const CONTROL_PREFIX = "/_worlds/";

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
    if (!target) {
      return Response.redirect(`${env.MAKEWORLDS_URL}/account`, 302);
    }
    const resolved = resolveHost(target.service);
    if (!resolved) {
      return Response.json(apiError("unknown_service", `No service at ${url.hostname}.`), {
        status: 404,
      });
    }
    const { service, host } = resolved;
    const hosting = HOSTING[service.name];
    const page = hosting.page(request, url, host);
    if (page === "asset") {
      return env.ASSETS.fetch(uiAsset(service.name, url.pathname, request));
    }
    const db = database(env.DB);
    const world = await liveWorld(db, target.worldId);
    if (!world) {
      return hosting.error(404, "world_not_found", "No such world, or it was archived.");
    }
    if (!world.services.includes(service.name)) {
      return hosting.error(
        404,
        "world_not_found",
        `This world was created without ${service.title}.`,
      );
    }

    const banner = (response: Response) =>
      withBanner(response, service.title, world, env.MAKEWORLDS_URL, hosting.bannerStyle);
    if (page === "members-only" && !(await canControl(request, db, world))) {
      return banner(signInPage(service.title, world, env.MAKEWORLDS_URL));
    }
    if (page === "ui") {
      return banner(await env.ASSETS.fetch(uiAsset(service.name, "/", request)));
    }
    if (url.pathname.startsWith(CONTROL_PREFIX) && !(await canControl(request, db, world))) {
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

function uiAsset(service: string, pathname: string, request: Request): Request {
  return new Request(new URL(`/${service}${pathname}`, request.url), request);
}
