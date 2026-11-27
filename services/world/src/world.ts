import { JiraService, type JiraHost } from "@worlds/jira/service";
import type { JiraSpec, JiraState } from "@worlds/jira/spec";
import { SlackService } from "@worlds/slack/service";
import type { SlackSpec, SlackState } from "@worlds/slack/spec";
import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env";
import { jiraOrigins } from "./origins";

export const SERVICE_HEADER = "x-worlds-service";
export const BASE_URL_HEADER = "x-worlds-base-url";
export const WORLD_ID_HEADER = "x-worlds-world-id";

const ARCHIVED_KEY = "world:archived";
const WORLD_ID_KEY = "world:id";

export class World extends DurableObject<Env> {
  private slackService: SlackService | null = null;
  private jiraService: JiraService | null = null;

  async fetch(request: Request): Promise<Response> {
    const service = request.headers.get(SERVICE_HEADER);
    const baseUrl = request.headers.get(BASE_URL_HEADER);
    const worldId = request.headers.get(WORLD_ID_HEADER);
    if (service === "slack" && baseUrl) return this.slack().fetch(request, baseUrl);
    if (isJiraHost(service) && worldId) {
      await this.rememberWorldId(worldId);
      return this.jira().fetch(request, service, jiraOrigins(this.env, worldId));
    }
    return Response.json({ ok: false, error: "unknown_service" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    if (await this.ctx.storage.get<boolean>(ARCHIVED_KEY)) return;
    const worldId = await this.ctx.storage.get<string>(WORLD_ID_KEY);
    await this.slack().alarm();
    await this.jira().alarm(worldId ? jiraOrigins(this.env, worldId) : null);
    const due = [await this.slack().nextDue(), await this.jira().nextDue()].filter(
      (value): value is number => value !== null,
    );
    if (due.length) await this.ctx.storage.setAlarm(Math.min(...due));
  }

  async setupSlack(spec: SlackSpec, baseUrl: string): Promise<SlackState> {
    return this.slack().setup(spec, baseUrl);
  }

  async slackState(): Promise<SlackState | null> {
    return this.slack().state();
  }

  async setupJira(worldId: string, spec: JiraSpec): Promise<JiraState> {
    await this.rememberWorldId(worldId);
    return this.jira().setup(spec, jiraOrigins(this.env, worldId));
  }

  async jiraState(): Promise<JiraState | null> {
    return this.jira().state();
  }

  async archive(): Promise<void> {
    await this.ctx.storage.put(ARCHIVED_KEY, true);
    await this.ctx.storage.deleteAlarm();
  }

  private async rememberWorldId(worldId: string): Promise<void> {
    if ((await this.ctx.storage.get<string>(WORLD_ID_KEY)) !== worldId)
      await this.ctx.storage.put(WORLD_ID_KEY, worldId);
  }

  private slack(): SlackService {
    this.slackService ??= new SlackService(this.ctx.storage);
    return this.slackService;
  }

  private jira(): JiraService {
    this.jiraService ??= new JiraService(this.ctx.storage);
    return this.jiraService;
  }
}

function isJiraHost(value: string | null): value is JiraHost {
  return value === "jira" || value === "jira-auth" || value === "jira-api";
}
