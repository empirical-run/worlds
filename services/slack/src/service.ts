import {
  createServer,
  restoreTokenMap,
  serializeTokenMap,
  type StoreSnapshot,
  type TokenEntry,
} from "@emulators/core";
import { getSlackStore, slackPlugin } from "@emulators/slack";

import {
  acceptRedirect,
  createApp,
  eventTarget,
  findApp,
  validateManifest,
  type SlackApp,
} from "./apps";
import { FileBlobs } from "./file-blobs";
import { seedWorkspace } from "./seed";
import { SlackDelivery } from "./slack-delivery";
import { registerSlackExtensions } from "./slack-extensions";
import { ACTING_METHODS, fileContent, userToken, worldState } from "./slack-ui";
import { DEFAULT_SLACK_SPEC, type SlackAppState, type SlackSpec, type SlackState } from "./spec";

type Persisted = { store: StoreSnapshot; tokens: TokenEntry[] };

type SlackServer = ReturnType<typeof createServer>;

const STATE_KEY = "slack";
const SPEC_STATE_KEY = "slack:state";
const BASE_URL_KEY = "slack:base-url";
const CONTROL_PREFIX = "/_worlds/";
const INSPECTOR_PATH = "/_inspector";
const MANIFEST_PREFIX = "/api/apps.manifest.";
const EVENTS_OWNER = "worlds";

export class WorldAlreadySetUp extends Error {
  constructor() {
    super("world_already_set_up");
  }
}

export class SlackService {
  private server: SlackServer | null = null;
  private delivery: SlackDelivery;
  private blobs: FileBlobs;

  constructor(private storage: DurableObjectStorage) {
    this.delivery = new SlackDelivery(storage, (appId, event) =>
      this.server ? eventTarget(this.server.store, appId ?? undefined, event) : null,
    );
    this.blobs = new FileBlobs(storage);
  }

  async setup(spec: SlackSpec, baseUrl: string): Promise<SlackState> {
    if (this.server || (await this.storage.get(STATE_KEY))) throw new WorldAlreadySetUp();
    await this.load(baseUrl, spec);
    return (await this.state()) as SlackState;
  }

  async state(): Promise<SlackState | null> {
    return (await this.storage.get<SlackState>(SPEC_STATE_KEY)) ?? null;
  }

  async fetch(request: Request, baseUrl: string): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(CONTROL_PREFIX)) return this.control(request, url, baseUrl);
    if (request.method === "GET" && url.pathname === "/oauth/v2/authorize") {
      const slack = await this.load(baseUrl);
      const clientId = url.searchParams.get("client_id");
      const redirectUri = url.searchParams.get("redirect_uri");
      if (clientId && redirectUri) {
        acceptRedirect(slack.store, clientId, redirectUri);
        await this.save();
      }
    }
    if (request.method === "POST" && url.pathname.startsWith(MANIFEST_PREFIX)) {
      return this.manifestMethod(
        url.pathname.slice(MANIFEST_PREFIX.length),
        await slackArgs(request),
        baseUrl,
      );
    }
    if (url.pathname === INSPECTOR_PATH) return this.inspector(request, url, baseUrl);
    const slack = await this.load(baseUrl);
    const response = await slack.app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") await this.save();
    return response;
  }

  async alarm(): Promise<void> {
    const baseUrl = await this.storage.get<string>(BASE_URL_KEY);
    if (baseUrl) await this.load(baseUrl);
    await this.delivery.run();
  }

  nextDue(): Promise<number | null> {
    return this.delivery.nextDue();
  }

  private async control(request: Request, url: URL, baseUrl: string): Promise<Response> {
    if (request.method === "POST" && url.pathname === "/_worlds/slack/tokens") {
      const { user_id: userId } = (await request.json()) as { user_id?: string };
      const slack = await this.load(baseUrl);
      const token = userId ? userToken(slack, userId) : null;
      if (!token) return Response.json({ ok: false, error: "user_not_found" }, { status: 400 });
      await this.save();
      return Response.json({ ok: true, token });
    }
    if (request.method === "GET" && url.pathname === "/_worlds/slack/state") {
      const slack = await this.load(baseUrl);
      return Response.json({ ok: true, ...worldState(slack, url.searchParams.get("channel")) });
    }
    if (request.method === "POST" && url.pathname === "/_worlds/slack/act")
      return this.actAs(request, url, baseUrl);
    if (request.method === "POST" && url.pathname === "/_worlds/slack/upload")
      return this.uploadAs(request, url, baseUrl);
    const fileMatch = url.pathname.match(/^\/_worlds\/slack\/files\/([A-Z0-9]+)$/);
    if (request.method === "GET" && fileMatch) {
      const slack = await this.load(baseUrl);
      return (
        fileContent(getSlackStore(slack.store), fileMatch[1]) ??
        Response.json({ ok: false, error: "file_not_found" }, { status: 404 })
      );
    }
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  private async manifestMethod(
    method: string,
    args: Record<string, unknown>,
    baseUrl: string,
  ): Promise<Response> {
    if (method === "export") {
      const slack = await this.load(baseUrl);
      const app = findApp(slack.store, typeof args.app_id === "string" ? args.app_id : "");
      return Response.json(
        app ? { ok: true, manifest: app.manifest } : { ok: false, error: "invalid_app_id" },
      );
    }
    if (method === "validate") {
      const checked = validateManifest(parseManifest(args.manifest));
      return Response.json(
        "problems" in checked
          ? { ok: false, error: "invalid_manifest", errors: checked.problems }
          : { ok: true },
      );
    }
    if (method === "create" || method === "update" || method === "delete") {
      return Response.json({
        ok: false,
        error: "restricted_action",
        detail: "A world's apps come from its spec. Create a new world with the apps you need.",
      });
    }
    return Response.json({ ok: false, error: "unknown_method" });
  }

  private async actAs(request: Request, url: URL, baseUrl: string): Promise<Response> {
    const {
      user_id: userId,
      method,
      args,
    } = (await request.json()) as {
      user_id?: string;
      method?: string;
      args?: Record<string, unknown>;
    };
    if (!method || !ACTING_METHODS.has(method))
      return Response.json({ ok: false, error: "method_not_allowed" }, { status: 400 });
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
    const target = await callSlack(slack, url.origin, token, "files.getUploadURLExternal", {
      filename: file.name,
      length: file.size,
    });
    if (!target.ok || typeof target.upload_url !== "string") return Response.json(target);
    const uploadPath = pathWithin(baseUrl, target.upload_url);
    const uploaded = await slack.app.fetch(
      new Request(`${url.origin}${uploadPath}`, { method: "POST", body: await file.arrayBuffer() }),
    );
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
    const html = (await response.text()).replaceAll(
      'href="/?',
      `href="${new URL(baseUrl).pathname.replace(/\/$/, "")}${INSPECTOR_PATH}?`,
    );
    return new Response(html, { status: response.status, headers: response.headers });
  }

  private async load(baseUrl: string, spec?: SlackSpec): Promise<SlackServer> {
    if (this.server) return this.server;
    const slack = createServer(slackPlugin, { baseUrl, baseUrlDerived: false });
    registerSlackExtensions(slack.app);
    const saved = await this.storage.get<Persisted>(STATE_KEY);
    if (saved) {
      slack.store.restore(await this.blobs.join(saved.store));
      restoreTokenMap(slack.tokenMap, saved.tokens);
    }
    const subscription = slack.webhooks.register({
      owner: EVENTS_OWNER,
      url: baseUrl,
      events: ["*"],
      active: true,
    });
    await this.delivery.attach(slack.webhooks, subscription.id);
    this.server = slack;
    await this.storage.put(BASE_URL_KEY, baseUrl);
    if (!saved) {
      await this.storage.put(
        SPEC_STATE_KEY,
        await seed(slack, spec ?? DEFAULT_SLACK_SPEC, baseUrl),
      );
      await this.save();
    }
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

async function seed(slack: SlackServer, spec: SlackSpec, baseUrl: string): Promise<SlackState> {
  const workspace = seedWorkspace(slack.store, spec);
  const userId = (ref: string) =>
    workspace.users.find((user) => user.name === ref || user.id === ref)?.id ?? "";
  for (const channel of workspace.channels) {
    for (const message of channel.messages) {
      const posted = await callSlack(
        slack,
        baseUrl,
        userToken(slack, userId(message.user)) ?? "",
        "chat.postMessage",
        { channel: channel.id, text: message.text },
      );
      for (const reply of message.replies ?? []) {
        await callSlack(
          slack,
          baseUrl,
          userToken(slack, userId(reply.user)) ?? "",
          "chat.postMessage",
          {
            channel: channel.id,
            text: reply.text,
            thread_ts: posted.ts,
          },
        );
      }
    }
  }
  const apps: SlackAppState[] = [];
  for (const appSpec of spec.apps ?? []) {
    const app = createApp(slack.store, appSpec.manifest, appSpec.credentials);
    const installSpec = appSpec.install === true ? {} : appSpec.install || null;
    let install: SlackAppState["install"] = null;
    if (installSpec) {
      const installer = installSpec.installer
        ? userId(installSpec.installer)
        : (workspace.users[0]?.id ?? "");
      if (installSpec.bot_user_id) pinBotUser(slack, app.app_id, installSpec.bot_user_id);
      const installed = await installApp(slack, app, baseUrl, installer);
      const botToken = installSpec.bot_token
        ? pinBotToken(slack, installed.bot_token, installSpec.bot_token)
        : installed.bot_token;
      const channels = installSpec.channels ?? [];
      for (const name of channels) addMember(slack, name, installed.bot_user_id);
      install = { installer, bot_user_id: installed.bot_user_id, bot_token: botToken, channels };
    }
    apps.push({
      app_id: app.app_id,
      manifest: app.manifest,
      credentials: app.credentials,
      install,
    });
  }
  return { ...workspace, apps };
}

function pinBotUser(slack: SlackServer, appId: string, botUserId: string): void {
  const record = getSlackStore(slack.store).oauthApps.findOneBy("app_id", appId);
  if (record) getSlackStore(slack.store).oauthApps.update(record.id, { bot_user_id: botUserId });
}

function pinBotToken(slack: SlackServer, minted: string, pinned: string): string {
  const entry = slack.tokenMap.get(minted);
  if (entry) {
    slack.tokenMap.delete(minted);
    slack.tokenMap.set(pinned, entry);
  }
  const tokens = getSlackStore(slack.store).tokens;
  for (const record of tokens.findBy("token", minted)) tokens.update(record.id, { token: pinned });
  return pinned;
}

function addMember(slack: SlackServer, channelName: string, userId: string): void {
  const channels = getSlackStore(slack.store).channels;
  const channel = channels.findOneBy("name", channelName);
  if (!channel || channel.members.includes(userId)) return;
  channels.update(channel.id, {
    members: [...channel.members, userId],
    num_members: channel.members.length + 1,
  });
}

async function installApp(
  slack: SlackServer,
  app: SlackApp,
  baseUrl: string,
  installerUserId: string,
): Promise<{ bot_token: string; bot_user_id: string }> {
  if (!installerUserId) throw new Error("the world has no user to install the app");
  const redirectUri = `${baseUrl}/_worlds/installed`;
  const callback = await slack.app.fetch(
    new Request(`${baseUrl}/oauth/v2/authorize/callback`, {
      method: "POST",
      body: new URLSearchParams({
        user_id: installerUserId,
        client_id: app.credentials.client_id,
        redirect_uri: redirectUri,
        scope: (app.manifest.oauth_config?.scopes?.bot ?? []).join(","),
        state: "worlds",
      }),
    }),
  );
  const code =
    new URL(callback.headers.get("location") ?? redirectUri).searchParams.get("code") ?? "";
  const response = await slack.app.fetch(
    new Request(`${baseUrl}/api/oauth.v2.access`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: app.credentials.client_id,
        client_secret: app.credentials.client_secret,
        code,
        redirect_uri: redirectUri,
      }),
    }),
  );
  const access = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
  };
  if (!access.ok || !access.access_token || !access.bot_user_id)
    throw new Error(`install failed: ${access.error}`);
  return { bot_token: access.access_token, bot_user_id: access.bot_user_id };
}

async function slackArgs(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.includes("application/json"))
    return ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return Object.fromEntries((await request.formData()).entries());
}

function parseManifest(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
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
