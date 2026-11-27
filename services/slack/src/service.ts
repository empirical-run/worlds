import {
  createServer,
  restoreTokenMap,
  serializeTokenMap,
  type StoreSnapshot,
  type TokenEntry,
} from "@emulators/core";
import { getSlackStore, seedFromConfig, slackPlugin } from "@emulators/slack";
import { FileBlobs } from "./file-blobs";
import { SlackDelivery } from "./slack-delivery";
import { registerSlackExtensions } from "./slack-extensions";
import { slackSeed, type SlackWorldConfig } from "./slack-seed";
import { ACTING_METHODS, fileContent, userToken, worldState } from "./slack-ui";

export type SlackConfig = SlackWorldConfig & { eventsUrl: string | null };

type Persisted = { store: StoreSnapshot; tokens: TokenEntry[] };

type SlackServer = ReturnType<typeof createServer>;

const STATE_KEY = "slack";
const CONTROL_PREFIX = "/_worlds/";
const INSPECTOR_PATH = "/_inspector";

export class SlackService {
  private server: SlackServer | null = null;
  private delivery: SlackDelivery | null;
  private blobs: FileBlobs;

  constructor(
    private storage: DurableObjectStorage,
    private config: SlackConfig,
  ) {
    this.delivery = config.eventsUrl ? new SlackDelivery(storage, config.eventsUrl, config.signingSecret) : null;
    this.blobs = new FileBlobs(storage);
  }

  async fetch(request: Request, baseUrl: string): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(CONTROL_PREFIX)) return this.control(request, url, baseUrl);
    if (url.pathname === INSPECTOR_PATH) return this.inspector(request, url, baseUrl);
    const slack = await this.load(baseUrl);
    const response = await slack.app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") await this.save();
    return response;
  }

  async alarm(): Promise<void> {
    await this.delivery?.run();
  }

  private async control(request: Request, url: URL, baseUrl: string): Promise<Response> {
    if (request.method === "POST" && url.pathname === "/_worlds/slack/redirect-uris") {
      const { redirect_uri: redirectUri } = (await request.json()) as { redirect_uri?: string };
      if (!redirectUri) return Response.json({ ok: false, error: "redirect_uri is required" }, { status: 400 });
      const slack = await this.load(baseUrl);
      const store = getSlackStore(slack.store);
      const app = store.oauthApps.findOneBy("client_id", this.config.clientId);
      if (!app) return Response.json({ ok: false, error: "app_not_found" }, { status: 404 });
      const redirectUris = app.redirect_uris.includes(redirectUri) ? app.redirect_uris : [...app.redirect_uris, redirectUri];
      store.oauthApps.update(app.id, { redirect_uris: redirectUris });
      await this.save();
      return Response.json({ ok: true, redirect_uris: redirectUris });
    }
    if (request.method === "GET" && url.pathname === "/_worlds/slack/state") {
      const slack = await this.load(baseUrl);
      return Response.json({ ok: true, ...worldState(slack, url.searchParams.get("channel")) });
    }
    if (request.method === "POST" && url.pathname === "/_worlds/slack/act") return this.actAs(request, url, baseUrl);
    if (request.method === "POST" && url.pathname === "/_worlds/slack/upload") return this.uploadAs(request, url, baseUrl);
    const fileMatch = url.pathname.match(/^\/_worlds\/slack\/files\/([A-Z0-9]+)$/);
    if (request.method === "GET" && fileMatch) {
      const slack = await this.load(baseUrl);
      return fileContent(getSlackStore(slack.store), fileMatch[1]) ?? Response.json({ ok: false, error: "file_not_found" }, { status: 404 });
    }
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  private async actAs(request: Request, url: URL, baseUrl: string): Promise<Response> {
    const { user_id: userId, method, args } = (await request.json()) as { user_id?: string; method?: string; args?: Record<string, unknown> };
    if (!method || !ACTING_METHODS.has(method)) return Response.json({ ok: false, error: "method_not_allowed" }, { status: 400 });
    const slack = await this.load(baseUrl);
    const token = userId ? userToken(slack, userId) : null;
    if (!token) return Response.json({ ok: false, error: "user_not_found" }, { status: 400 });
    const result = await callSlack(slack, url.origin, token, method, args ?? {});
    await this.save();
    return Response.json(result);
  }

  private async uploadAs(request: Request, url: URL, baseUrl: string): Promise<Response> {
    const form = await request.formData();
    const file = form.get("file");
    const userId = form.get("user_id");
    const channel = form.get("channel");
    if (!(file instanceof File) || typeof userId !== "string" || typeof channel !== "string") {
      return Response.json({ ok: false, error: "invalid_arguments" }, { status: 400 });
    }
    const slack = await this.load(baseUrl);
    const token = userToken(slack, userId);
    if (!token) return Response.json({ ok: false, error: "user_not_found" }, { status: 400 });
    const target = await callSlack(slack, url.origin, token, "files.getUploadURLExternal", { filename: file.name, length: file.size });
    if (!target.ok || typeof target.upload_url !== "string") return Response.json(target);
    const uploadPath = pathWithin(baseUrl, target.upload_url);
    const uploaded = await slack.app.fetch(new Request(`${url.origin}${uploadPath}`, { method: "POST", body: await file.arrayBuffer() }));
    if (!uploaded.ok) return Response.json({ ok: false, error: "upload_failed" }, { status: 502 });
    const threadTs = form.get("thread_ts");
    const text = form.get("text");
    const result = await callSlack(slack, url.origin, token, "files.completeUploadExternal", {
      files: [{ id: target.file_id, title: file.name }],
      channel_id: channel,
      ...(typeof threadTs === "string" && threadTs ? { thread_ts: threadTs } : {}),
      ...(typeof text === "string" && text ? { initial_comment: text } : {}),
    });
    await this.save();
    return Response.json(result);
  }

  private async inspector(request: Request, url: URL, baseUrl: string): Promise<Response> {
    const slack = await this.load(baseUrl);
    const response = await slack.app.fetch(new Request(`${url.origin}/${url.search}`, request));
    const html = (await response.text()).replaceAll('href="/?', `href="${new URL(baseUrl).pathname.replace(/\/$/, "")}${INSPECTOR_PATH}?`);
    return new Response(html, { status: response.status, headers: response.headers });
  }

  private async load(baseUrl: string): Promise<SlackServer> {
    if (this.server) return this.server;
    const slack = createServer(slackPlugin, { baseUrl, baseUrlDerived: false });
    registerSlackExtensions(slack.app);
    const saved = await this.storage.get<Persisted>(STATE_KEY);
    if (saved) {
      slack.store.restore(await this.blobs.join(saved.store));
      restoreTokenMap(slack.tokenMap, saved.tokens);
    } else {
      slackPlugin.seed?.(slack.store, baseUrl);
      seedFromConfig(slack.store, baseUrl, slackSeed(this.config));
    }
    if (this.delivery && this.config.eventsUrl) {
      const subscription = slack.webhooks.register({ owner: "slack", url: this.config.eventsUrl, events: ["*"], active: true });
      await this.delivery.attach(slack.webhooks, subscription.id);
    }
    this.server = slack;
    if (!saved) await this.save();
    return slack;
  }

  private async save(): Promise<void> {
    if (!this.server) return;
    await this.storage.put<Persisted>(STATE_KEY, {
      store: await this.blobs.split(this.server.store.snapshot()),
      tokens: serializeTokenMap(this.server.tokenMap),
    });
  }
}

function pathWithin(baseUrl: string, absolute: string): string {
  const basePath = new URL(baseUrl).pathname.replace(/\/$/, "");
  const { pathname, search } = new URL(absolute);
  return `${pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname}${search}`;
}

async function callSlack(
  slack: SlackServer,
  origin: string,
  token: string,
  method: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await slack.app.fetch(
    new Request(`${origin}/api/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    }),
  );
  return (await response.json()) as Record<string, unknown>;
}
