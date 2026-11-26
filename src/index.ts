import { DurableObject } from "cloudflare:workers";
import {
  createServer,
  restoreTokenMap,
  serializeTokenMap,
  type StoreSnapshot,
  type TokenEntry,
} from "@emulators/core";
import { getSlackStore, seedFromConfig, slackPlugin } from "@emulators/slack";
import { registerSlackExtensions } from "./slack-extensions";
import { slackSeed } from "./slack-seed";

type Env = {
  WORLD: DurableObjectNamespace<World>;
  WORLDS_ADMIN_TOKEN: string;
  SLACK_EVENTS_URL: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_USER_TOKEN: string;
  SLACK_REDIRECT_URIS: string;
};

type Persisted = { store: StoreSnapshot; tokens: TokenEntry[] };

type SlackServer = ReturnType<typeof createServer>;

const STATE_KEY = "slack";
const DEFAULT_WORLD = "default";
const ADMIN_PREFIX = "/_worlds/";

function isAdmin(request: Request, env: Env): boolean {
  return Boolean(env.WORLDS_ADMIN_TOKEN) && request.headers.get("authorization") === `Bearer ${env.WORLDS_ADMIN_TOKEN}`;
}

export class World extends DurableObject<Env> {
  private slack: SlackServer | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(ADMIN_PREFIX)) return this.admin(request, url);
    const slack = await this.loadSlack(url.origin);
    const response = await slack.app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") await this.saveSlack();
    return response;
  }

  private async admin(request: Request, url: URL): Promise<Response> {
    if (!isAdmin(request, this.env)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (request.method === "POST" && url.pathname === "/_worlds/reset") {
      await this.ctx.storage.deleteAll();
      this.slack = null;
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/_worlds/slack/redirect-uris") {
      const { redirect_uri: redirectUri } = (await request.json()) as { redirect_uri?: string };
      if (!redirectUri) return Response.json({ ok: false, error: "redirect_uri is required" }, { status: 400 });
      const slack = await this.loadSlack(url.origin);
      const app = getSlackStore(slack.store).oauthApps.findOneBy("client_id", this.env.SLACK_CLIENT_ID);
      if (!app) return Response.json({ ok: false, error: "app_not_found" }, { status: 404 });
      const redirectUris = app.redirect_uris.includes(redirectUri) ? app.redirect_uris : [...app.redirect_uris, redirectUri];
      getSlackStore(slack.store).oauthApps.update(app.id, { redirect_uris: redirectUris });
      await this.saveSlack();
      return Response.json({ ok: true, redirect_uris: redirectUris });
    }
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  private async loadSlack(origin: string): Promise<SlackServer> {
    if (this.slack) return this.slack;
    const slack = createServer(slackPlugin, { baseUrl: origin, baseUrlDerived: false });
    registerSlackExtensions(slack.app);
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
          userToken: this.env.SLACK_USER_TOKEN,
          redirectUris: this.env.SLACK_REDIRECT_URIS.split(",").filter(Boolean),
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
