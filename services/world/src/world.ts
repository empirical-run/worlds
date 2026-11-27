import { SlackService } from "@worlds/slack/service";
import type { SlackSpec, SlackState } from "@worlds/slack/spec";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export const SERVICE_HEADER = "x-worlds-service";
export const BASE_URL_HEADER = "x-worlds-base-url";
const ARCHIVED_KEY = "world:archived";

export class World extends DurableObject<Env> {
  private slackService: SlackService | null = null;

  async fetch(request: Request): Promise<Response> {
    const baseUrl = request.headers.get(BASE_URL_HEADER);
    if (request.headers.get(SERVICE_HEADER) !== "slack" || !baseUrl) {
      return Response.json({ ok: false, error: "unknown_service" }, { status: 404 });
    }
    return this.slack().fetch(request, baseUrl);
  }

  async alarm(): Promise<void> {
    if (await this.ctx.storage.get<boolean>(ARCHIVED_KEY)) return;
    await this.slack().alarm();
  }

  async setupSlack(spec: SlackSpec, baseUrl: string): Promise<SlackState> {
    return this.slack().setup(spec, baseUrl);
  }

  async slackState(): Promise<SlackState | null> {
    return this.slack().state();
  }

  async archive(): Promise<void> {
    await this.ctx.storage.put(ARCHIVED_KEY, true);
    await this.ctx.storage.deleteAlarm();
  }

  private slack(): SlackService {
    this.slackService ??= new SlackService(this.ctx.storage);
    return this.slackService;
  }
}
