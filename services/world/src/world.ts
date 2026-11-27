import type { WorldContext } from "@worlds/contract/hosting";
import {
  SERVICES,
  resolveHost,
  type ServiceName,
  type ServiceState,
  type WorldSpecs,
  type WorldStates,
} from "@worlds/services";
import { serviceRuntimes, type ServiceRuntimes } from "@worlds/services/hosting";
import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env";
import { serviceOrigin } from "./origins";

export const HOST_HEADER = "x-worlds-host";
export const WORLD_ID_HEADER = "x-worlds-world-id";

const ARCHIVED_KEY = "world:archived";
const WORLD_ID_KEY = "world:id";

export class World extends DurableObject<Env> {
  private runtimes: ServiceRuntimes | null = null;

  async fetch(request: Request): Promise<Response> {
    const target = resolveHost(request.headers.get(HOST_HEADER) ?? "");
    const worldId = request.headers.get(WORLD_ID_HEADER);
    if (!target || !worldId)
      return Response.json({ ok: false, error: "unknown_service" }, { status: 404 });
    await this.rememberWorldId(worldId);
    const runtime = this.services()[target.service.name];
    return runtime.fetch(request, target.host, this.world(worldId));
  }

  async alarm(): Promise<void> {
    if (await this.ctx.storage.get<boolean>(ARCHIVED_KEY)) return;
    const worldId = await this.ctx.storage.get<string>(WORLD_ID_KEY);
    const world = worldId ? this.world(worldId) : null;
    const due: number[] = [];
    for (const { name } of SERVICES) {
      const runtime = this.services()[name];
      await runtime.alarm(world);
      const next = await runtime.nextDue();
      if (next !== null) due.push(next);
    }
    if (due.length) await this.ctx.storage.setAlarm(Math.min(...due));
  }

  async setup(worldId: string, specs: WorldSpecs): Promise<WorldStates> {
    await this.rememberWorldId(worldId);
    const world = this.world(worldId);
    const states: [ServiceName, unknown][] = [];
    for (const { name } of SERVICES)
      states.push([name, await this.setupService(name, specs, world)]);
    return Object.fromEntries(states) as WorldStates;
  }

  async states(): Promise<WorldStates> {
    const states: [ServiceName, unknown][] = [];
    for (const { name } of SERVICES) states.push([name, await this.services()[name].state()]);
    return Object.fromEntries(states) as WorldStates;
  }

  async archive(): Promise<void> {
    await this.ctx.storage.put(ARCHIVED_KEY, true);
    await this.ctx.storage.deleteAlarm();
  }

  private setupService<Name extends ServiceName>(
    name: Name,
    specs: WorldSpecs,
    world: WorldContext,
  ): Promise<ServiceState<Name>> {
    return this.services()[name].setup(specs[name], world);
  }

  private world(worldId: string): WorldContext {
    return { worldId, origin: (host) => serviceOrigin(this.env, worldId, host) };
  }

  private async rememberWorldId(worldId: string): Promise<void> {
    if ((await this.ctx.storage.get<string>(WORLD_ID_KEY)) !== worldId)
      await this.ctx.storage.put(WORLD_ID_KEY, worldId);
  }

  private services(): ServiceRuntimes {
    this.runtimes ??= serviceRuntimes(this.ctx.storage);
    return this.runtimes;
  }
}
