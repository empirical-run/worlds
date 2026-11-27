import {
  createServer,
  restoreTokenMap,
  serializeTokenMap,
  type StoreSnapshot,
  type TokenEntry,
} from "@emulators/core";
import { getSlackStore, slackPlugin } from "@emulators/slack";
import { apiError, routes, type ApiError } from "@worlds/contract";

import {
  acceptRedirect,
  createApp,
  eventTarget,
  findApp,
  validateManifest,
  type SlackApp,
} from "./apps";
import {
  actRoute,
  fileRoute,
  stateRoute,
  tokenRoute,
  uploadRoute,
  type SlackWebApiResponse,
} from "./contract";
import { FileBlobs } from "./file-blobs";
import { seededUserId, seedWorkspace } from "./seed";
import { SlackDelivery } from "./slack-delivery";
import { registerSlackExtensions } from "./slack-extensions";
import { findHuman, fileContent, userToken, worldState } from "./slack-ui";
import type { SlackAppState, SlackSpec, SlackState } from "./spec";

type Persisted = { store: StoreSnapshot; tokens: TokenEntry[] };

type SlackServer = ReturnType<typeof createServer>;

const STATE_KEY = "slack";
const SPEC_STATE_KEY = "slack:state";
const BASE_URL_KEY = "slack:base-url";
const CONTROL_PREFIX = "/_worlds/";
export const INSPECTOR_PATH = "/_inspector";
const MANIFEST_PREFIX = "/api/apps.manifest.";
const EVENTS_OWNER = "worlds";

export class WorldAlreadySetUp extends Error {
  constructor() {
    super("world_already_set_up");
  }
}

export class SlackNotSetUp extends Error {
  constructor() {
    super("slack_not_set_up");
  }
}

export class SlackService {
  private server: SlackServer | null = null;
  private delivery: SlackDelivery;
  private blobs: FileBlobs;
  private control = this.controlRoutes();

  constructor(private storage: DurableObjectStorage) {
    this.delivery = new SlackDelivery(storage, (appId, event) =>
      this.server ? eventTarget(this.server.store, appId ?? undefined, event) : null,
    );
    this.blobs = new FileBlobs(storage);
  }

  async setup(spec: SlackSpec, baseUrl: string): Promise<SlackState> {
    if (this.server || (await this.storage.get(STATE_KEY))) {
      throw new WorldAlreadySetUp();
    }
    await this.load(baseUrl, spec);
    return (await this.state()) as SlackState;
  }

  async state(): Promise<SlackState | null> {
    return (await this.storage.get<SlackState>(SPEC_STATE_KEY)) ?? null;
  }

  async fetch(request: Request, baseUrl: string): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(CONTROL_PREFIX)) {
      return this.control.fetch(request, { baseUrl });
    }
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
    if (url.pathname === INSPECTOR_PATH) {
      return this.inspector(request, url, baseUrl);
    }
    const slack = await this.load(baseUrl);
    const response = await slack.app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      await this.save();
    }
    return response;
  }

  async alarm(): Promise<void> {
    const baseUrl = await this.storage.get<string>(BASE_URL_KEY);
    if (baseUrl) {
      await this.load(baseUrl);
    }
    await this.delivery.run();
  }

  nextDue(): Promise<number | null> {
    return this.delivery.nextDue();
  }

  private controlRoutes() {
    const app = routes<{ Bindings: { baseUrl: string } }>()
      .openapi(tokenRoute, async (c) => {
        const { user } = c.req.valid("json");
        const slack = await this.load(c.env.baseUrl);
        const userId = findHuman(slack, user);
        const token = userId ? userToken(slack, userId) : null;
        if (!userId || !token) {
          return c.json(unknownUser(user), 400);
        }
        await this.save();
        return c.json({ user_id: userId, token }, 200);
      })
      .openapi(stateRoute, async (c) => {
        const slack = await this.load(c.env.baseUrl);
        return c.json(worldState(slack, c.req.valid("query").channel ?? null), 200);
      })
      .openapi(actRoute, async (c) => {
        const { user, method, args } = c.req.valid("json");
        const slack = await this.load(c.env.baseUrl);
        const userId = findHuman(slack, user);
        const token = userId ? userToken(slack, userId) : null;
        if (!token) {
          return c.json(unknownUser(user), 400);
        }
        const result = await callSlack(slack, new URL(c.req.url).origin, token, method, args ?? {});
        await this.save();
        return c.json(result, 200);
      })
      .openapi(uploadRoute, async (c) => {
        const { user, channel, file, text, thread_ts: threadTs } = c.req.valid("form");
        const slack = await this.load(c.env.baseUrl);
        const userId = findHuman(slack, user);
        const token = userId ? userToken(slack, userId) : null;
        if (!token) {
          return c.json(unknownUser(user), 400);
        }
        const origin = new URL(c.req.url).origin;
        const target = await callSlack(slack, origin, token, "files.getUploadURLExternal", {
          filename: file.name,
          length: file.size,
        });
        if (!target.ok || typeof target.upload_url !== "string") {
          return c.json(target, 200);
        }
        const uploaded = await slack.app.fetch(
          new Request(`${origin}${pathWithin(c.env.baseUrl, target.upload_url)}`, {
            method: "POST",
            body: await file.arrayBuffer(),
          }),
        );
        if (!uploaded.ok) {
          return c.json(apiError("upload_failed", "The file couldn't be uploaded."), 502);
        }
        const result = await callSlack(slack, origin, token, "files.completeUploadExternal", {
          files: [{ id: target.file_id, title: file.name }],
          channel_id: channel,
          ...(threadTs ? { thread_ts: threadTs } : {}),
          ...(text ? { initial_comment: text } : {}),
        });
        await this.save();
        return c.json(result, 200);
      })
      .openapi(fileRoute, async (c) => {
        const { fileId } = c.req.valid("param");
        const slack = await this.load(c.env.baseUrl);
        return (
          fileContent(getSlackStore(slack.store), fileId) ??
          c.json(apiError("file_not_found", `No file ${fileId} in this world.`), 404)
        );
      });
    app.notFound((c) => c.json(apiError("not_found", "No such endpoint."), 404));
    return app;
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
    if (this.server) {
      return this.server;
    }
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
      if (!spec) {
        throw new SlackNotSetUp();
      }
      await this.storage.put(SPEC_STATE_KEY, await seed(slack, spec, baseUrl));
      await this.save();
    }
    return slack;
  }

  private async save(): Promise<void> {
    if (!this.server) {
      return;
    }
    await this.storage.put<Persisted>(STATE_KEY, {
      store: await this.blobs.split(this.server.store.snapshot()),
      tokens: serializeTokenMap(this.server.tokenMap),
    });
  }
}

async function seed(slack: SlackServer, spec: SlackSpec, baseUrl: string): Promise<SlackState> {
  const workspace = seedWorkspace(slack.store, spec);
  const userId = (ref: string) => seededUserId(workspace.users, ref);
  const authorToken = (ref: string) => {
    const token = userToken(slack, userId(ref));
    if (!token) {
      throw new Error(`slack spec: ${ref} can't post messages`);
    }
    return token;
  };
  for (const channel of workspace.channels) {
    for (const message of channel.messages) {
      const posted = await callSlack(
        slack,
        baseUrl,
        authorToken(message.user),
        "chat.postMessage",
        { channel: channel.id, text: message.text },
      );
      for (const reply of message.replies ?? []) {
        await callSlack(slack, baseUrl, authorToken(reply.user), "chat.postMessage", {
          channel: channel.id,
          text: reply.text,
          thread_ts: posted.ts,
        });
      }
    }
  }
  const apps: SlackAppState[] = [];
  for (const appSpec of spec.apps ?? []) {
    const app = createApp(slack.store, appSpec.manifest, appSpec.credentials);
    const installSpec = appSpec.install;
    let install: SlackAppState["install"] = null;
    if (installSpec) {
      const installer = userId(installSpec.installer);
      if (installSpec.bot_user_id) {
        pinBotUser(slack, app.app_id, installSpec.bot_user_id);
      }
      const installed = await installApp(slack, app, baseUrl, installer);
      const botToken = installSpec.bot_token
        ? pinBotToken(slack, installed.bot_token, installSpec.bot_token)
        : installed.bot_token;
      const channels = installSpec.channels ?? [];
      for (const name of channels) {
        addMember(slack, name, installed.bot_user_id);
      }
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
  if (record) {
    getSlackStore(slack.store).oauthApps.update(record.id, { bot_user_id: botUserId });
  }
}

function pinBotToken(slack: SlackServer, minted: string, pinned: string): string {
  const entry = slack.tokenMap.get(minted);
  if (entry) {
    slack.tokenMap.delete(minted);
    slack.tokenMap.set(pinned, entry);
  }
  const tokens = getSlackStore(slack.store).tokens;
  for (const record of tokens.findBy("token", minted)) {
    tokens.update(record.id, { token: pinned });
  }
  return pinned;
}

function addMember(slack: SlackServer, channelName: string, userId: string): void {
  const channels = getSlackStore(slack.store).channels;
  const channel = channels.findOneBy("name", channelName);
  if (!channel || channel.members.includes(userId)) {
    return;
  }
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
  if (!installerUserId) {
    throw new Error("the world has no user to install the app");
  }
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
  if (!access.ok || !access.access_token || !access.bot_user_id) {
    throw new Error(`install failed: ${access.error}`);
  }
  return { bot_token: access.access_token, bot_user_id: access.bot_user_id };
}

function unknownUser(ref: string): ApiError {
  return apiError("user_not_found", `No user named ${ref} in this world, or it is a bot.`);
}

async function slackArgs(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.includes("application/json")) {
    return ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  }
  return Object.fromEntries((await request.formData()).entries());
}

function parseManifest(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
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
): Promise<SlackWebApiResponse> {
  const response = await slack.app.fetch(
    new Request(`${origin}/api/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    }),
  );
  return (await response.json()) as SlackWebApiResponse;
}
