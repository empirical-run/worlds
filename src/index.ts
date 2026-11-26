import { DurableObject } from "cloudflare:workers";
import {
  createServer,
  restoreTokenMap,
  serializeTokenMap,
  type StoreSnapshot,
  type TokenEntry,
} from "@emulators/core";
import { seedFromConfig, slackPlugin } from "@emulators/slack";
import { slackSeed } from "./slack-seed";

type Env = {
  WORLD: DurableObjectNamespace<World>;
  SLACK_EVENTS_URL: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_REDIRECT_URIS: string;
};

type Persisted = { store: StoreSnapshot; tokens: TokenEntry[] };

type SlackServer = ReturnType<typeof createServer>;

const STATE_KEY = "slack";
const DEFAULT_WORLD = "default";

export class World extends DurableObject<Env> {
  private slack: SlackServer | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/_worlds/reset") {
      await this.ctx.storage.deleteAll();
      this.slack = null;
      return Response.json({ ok: true });
    }
    const slack = await this.loadSlack(url.origin);
    const response = await slack.app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") await this.saveSlack();
    return response;
  }

  private async loadSlack(origin: string): Promise<SlackServer> {
    if (this.slack) return this.slack;
    const slack = createServer(slackPlugin, { baseUrl: origin, baseUrlDerived: false });
    const saved = await this.ctx.storage.get<Persisted>(STATE_KEY);
    if (saved) {
      slack.store.restore(saved.store);
      restoreTokenMap(slack.tokenMap, saved.tokens);
    } else {
      slackPlugin.seed?.(slack.store, origin);
      seedFromConfig(
        slack.store,
        origin,
        slackSeed({
          signingSecret: this.env.SLACK_SIGNING_SECRET,
          clientId: this.env.SLACK_CLIENT_ID,
          clientSecret: this.env.SLACK_CLIENT_SECRET,
          redirectUris: this.env.SLACK_REDIRECT_URIS.split(","),
        }),
      );
    }
    slack.webhooks.register({ owner: "slack", url: this.env.SLACK_EVENTS_URL, events: ["*"], active: true });
    this.slack = slack;
    if (!saved) await this.saveSlack();
    return slack;
  }

  private async saveSlack(): Promise<void> {
    if (!this.slack) return;
    await this.ctx.storage.put<Persisted>(STATE_KEY, {
      store: this.slack.store.snapshot(),
      tokens: serializeTokenMap(this.slack.tokenMap),
    });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.WORLD.get(env.WORLD.idFromName(DEFAULT_WORLD)).fetch(request);
  },
};
