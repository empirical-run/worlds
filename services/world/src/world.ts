import { SlackService } from "@worlds/slack/service";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export const SERVICE_HEADER = "x-worlds-service";
export const BASE_URL_HEADER = "x-worlds-base-url";

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
    await this.slack().alarm();
  }

  async purge(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.slackService = null;
  }

  private slack(): SlackService {
    this.slackService ??= new SlackService(this.ctx.storage, {
      signingSecret: this.env.SLACK_SIGNING_SECRET,
      clientId: this.env.SLACK_CLIENT_ID,
      clientSecret: this.env.SLACK_CLIENT_SECRET,
      userToken: this.env.SLACK_USER_TOKEN,
      redirectUris: this.env.SLACK_REDIRECT_URIS.split(",").filter(Boolean),
      eventsUrl: this.env.SLACK_EVENTS_URL || null,
    });
    return this.slackService;
  }
}
