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
import {
  acceptRedirect,
  clientIdTaken,
  createApp,
  deleteApp,
  eventTarget,
  findApp,
  updateApp,
  validateManifest,
  type SlackApp,
  type SlackCredentials,
  type SlackManifest,
} from "./apps";
import { slackSeed } from "./slack-seed";
import { ACTING_METHODS, fileContent, userToken, worldState } from "./slack-ui";

export type AppSpec = { manifest: SlackManifest; credentials?: Partial<SlackCredentials>; install?: boolean };

export type Installation = { bot_token: string; bot_user_id: string; team_id: string };

export type CreatedApp = { app_id: string; credentials: SlackCredentials; installation: Installation | null };

type Persisted = { store: StoreSnapshot; tokens: TokenEntry[] };

type SlackServer = ReturnType<typeof createServer>;

const STATE_KEY = "slack";
const CONTROL_PREFIX = "/_worlds/";
const INSPECTOR_PATH = "/_inspector";
const MANIFEST_PREFIX = "/api/apps.manifest.";
const EVENTS_OWNER = "worlds";

export class ClientIdTaken extends Error {
  constructor() {
    super("client_id_taken");
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

  async createApps(specs: AppSpec[], baseUrl: string): Promise<CreatedApp[]> {
    const slack = await this.load(baseUrl);
    const pinnedIds = specs.map((spec) => spec.credentials?.client_id).filter((id): id is string => Boolean(id));
    if (new Set(pinnedIds).size !== pinnedIds.length || pinnedIds.some((id) => clientIdTaken(slack.store, id))) {
      throw new ClientIdTaken();
    }
    const created: CreatedApp[] = [];
    for (const spec of specs) {
      const app = createApp(slack.store, spec.manifest, spec.credentials);
      created.push({ app_id: app.app_id, credentials: app.credentials, installation: spec.install ? await install(slack, app, baseUrl) : null });
    }
    await this.save();
    return created;
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
      return this.manifestMethod(url.pathname.slice(MANIFEST_PREFIX.length), await slackArgs(request), baseUrl);
    }
    if (url.pathname === INSPECTOR_PATH) return this.inspector(request, url, baseUrl);
    const slack = await this.load(baseUrl);
    const response = await slack.app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") await this.save();
    return response;
  }

  async alarm(): Promise<void> {
    await this.delivery.run();
  }

  private async control(request: Request, url: URL, baseUrl: string): Promise<Response> {
    if (request.method === "POST" && url.pathname === "/_worlds/slack/apps") {
      const spec = (await request.json()) as Partial<AppSpec>;
      const checked = validateManifest(spec.manifest);
      if ("problems" in checked) return Response.json({ ok: false, error: "invalid_manifest", errors: checked.problems }, { status: 400 });
      try {
        const [created] = await this.createApps([{ manifest: checked.manifest, credentials: spec.credentials, install: spec.install }], baseUrl);
        return Response.json({ ok: true, ...created });
      } catch (error) {
        if (error instanceof ClientIdTaken) return Response.json({ ok: false, error: "client_id_taken" }, { status: 409 });
        throw error;
      }
    }
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
    if (request.method === "POST" && url.pathname === "/_worlds/slack/act") return this.actAs(request, url, baseUrl);
    if (request.method === "POST" && url.pathname === "/_worlds/slack/upload") return this.uploadAs(request, url, baseUrl);
    const fileMatch = url.pathname.match(/^\/_worlds\/slack\/files\/([A-Z0-9]+)$/);
    if (request.method === "GET" && fileMatch) {
      const slack = await this.load(baseUrl);
      return fileContent(getSlackStore(slack.store), fileMatch[1]) ?? Response.json({ ok: false, error: "file_not_found" }, { status: 404 });
    }
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  private async manifestMethod(method: string, args: Record<string, unknown>, baseUrl: string): Promise<Response> {
    const slack = await this.load(baseUrl);
    const appId = typeof args.app_id === "string" ? args.app_id : "";
    if (method === "export") {
      const app = findApp(slack.store, appId);
      return Response.json(app ? { ok: true, manifest: app.manifest } : { ok: false, error: "invalid_app_id" });
    }
    if (method === "delete") {
      const deleted = deleteApp(slack.store, appId);
      if (deleted) await this.save();
      return Response.json(deleted ? { ok: true } : { ok: false, error: "invalid_app_id" });
    }
    if (method !== "validate" && method !== "create" && method !== "update") return Response.json({ ok: false, error: "unknown_method" });
    const checked = validateManifest(parseManifest(args.manifest));
    if ("problems" in checked) return Response.json({ ok: false, error: "invalid_manifest", errors: checked.problems });
    if (method === "validate") return Response.json({ ok: true });
    if (method === "update") {
      const updated = updateApp(slack.store, appId, checked.manifest);
      if (!updated) return Response.json({ ok: false, error: "invalid_app_id" });
      await this.save();
      return Response.json({ ok: true, app_id: updated.app_id, permissions_updated: false });
    }
    const app = createApp(slack.store, checked.manifest);
    await this.save();
    return Response.json({ ok: true, app_id: app.app_id, credentials: app.credentials, oauth_authorize_url: authorizeUrl(app, baseUrl) });
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
      seedFromConfig(slack.store, baseUrl, slackSeed());
    }
    const subscription = slack.webhooks.register({ owner: EVENTS_OWNER, url: baseUrl, events: ["*"], active: true });
    await this.delivery.attach(slack.webhooks, subscription.id);
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

async function install(slack: SlackServer, app: SlackApp, baseUrl: string): Promise<Installation> {
  const installer = getSlackStore(slack.store).users.all().find((user) => !user.deleted && !user.is_bot);
  if (!installer) throw new Error("the world has no user to install the app");
  const redirectUri = `${baseUrl}/_worlds/installed`;
  const callback = await slack.app.fetch(
    new Request(`${baseUrl}/oauth/v2/authorize/callback`, {
      method: "POST",
      body: new URLSearchParams({
        user_id: installer.user_id,
        client_id: app.credentials.client_id,
        redirect_uri: redirectUri,
        scope: (app.manifest.oauth_config?.scopes?.bot ?? []).join(","),
        state: "worlds",
      }),
    }),
  );
  const code = new URL(callback.headers.get("location") ?? redirectUri).searchParams.get("code") ?? "";
  const response = await slack.app.fetch(
    new Request(`${baseUrl}/api/oauth.v2.access`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: app.credentials.client_id, client_secret: app.credentials.client_secret, code, redirect_uri: redirectUri }),
    }),
  );
  const access = (await response.json()) as { ok: boolean; error?: string; access_token?: string; bot_user_id?: string; team?: { id: string } };
  if (!access.ok || !access.access_token || !access.bot_user_id || !access.team) throw new Error(`install failed: ${access.error}`);
  return { bot_token: access.access_token, bot_user_id: access.bot_user_id, team_id: access.team.id };
}

function authorizeUrl(app: SlackApp, baseUrl: string): string {
  const params = new URLSearchParams({ client_id: app.credentials.client_id, scope: (app.manifest.oauth_config?.scopes?.bot ?? []).join(",") });
  return `${baseUrl}/oauth/v2/authorize?${params}`;
}

async function slackArgs(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.includes("application/json")) return ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
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
