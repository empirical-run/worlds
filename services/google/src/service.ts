import { apiError, routes } from "@worlds/contract";
import { Hono, type Context } from "hono";

import { createFileRoute, createGrantRoute, googleStateRoute, type GoogleHost } from "./contract";
import { drive } from "./drive";
import { isoDate, type FileRecord, type GoogleData, type Origins } from "./model";
import { avatarSvg, consentPage, drivePage, errorPage, filePage, notFoundPage } from "./pages";
import { pickerPage, pickerScript } from "./picker";
import { FOLDER_MIME, isEditorMime, type GoogleSpec, type GoogleState } from "./spec";
import { GoogleWorld, emptyData, seedFiles, type Bearer, type ContentStore } from "./world";

const STATE_KEY = "google";
const CONTENT_PREFIX = "google:content:";

export type Env = { Variables: { world: GoogleWorld } };

export type AppContext = Context<Env>;

export class GoogleNotSetUp extends Error {
  constructor() {
    super("google_not_set_up");
  }
}

export class GoogleService {
  private world: GoogleWorld | null = null;
  private readonly apps: Record<GoogleHost, Hono<Env>>;
  private readonly content: ContentStore;

  constructor(private readonly storage: DurableObjectStorage) {
    this.apps = { google: accountRoutes(), "google-api": apiRoutes() };
    this.content = {
      get: async (id) => (await storage.get<Uint8Array>(`${CONTENT_PREFIX}${id}`)) ?? null,
      put: (id, bytes) => storage.put(`${CONTENT_PREFIX}${id}`, bytes),
      delete: async (ids) => {
        await storage.delete(ids.map((id) => `${CONTENT_PREFIX}${id}`));
      },
    };
  }

  async setup(spec: GoogleSpec, origins: Origins): Promise<GoogleState> {
    return (await this.load(origins, spec)).state;
  }

  async state(): Promise<GoogleState | null> {
    return (await this.storage.get<GoogleData>(STATE_KEY))?.state ?? null;
  }

  async fetch(request: Request, host: GoogleHost, origins: Origins): Promise<Response> {
    const world = await this.load(origins);
    const app = new Hono<Env>();
    app.use(async (c, next) => {
      c.set("world", world);
      await next();
    });
    app.route("/", this.apps[host]);
    const response = await app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
      await this.save();
    }
    return response;
  }

  private async load(origins: Origins, spec?: GoogleSpec): Promise<GoogleWorld> {
    if (this.world) {
      return this.world;
    }
    const saved = await this.storage.get<GoogleData>(STATE_KEY);
    if (saved) {
      this.world = new GoogleWorld(saved, origins, this.content);
      return this.world;
    }
    if (!spec) {
      throw new GoogleNotSetUp();
    }
    this.world = new GoogleWorld(emptyData(spec), origins, this.content);
    await seedFiles(this.world, spec);
    await this.save();
    return this.world;
  }

  private async save(): Promise<void> {
    if (this.world) {
      await this.storage.put<GoogleData>(STATE_KEY, this.world.data);
    }
  }
}

function accountRoutes(): Hono<Env> {
  const app = new Hono<Env>();
  for (const path of ["/o/oauth2/v2/auth", "/o/oauth2/auth"]) {
    app.get(path, (c) => {
      const params = new URL(c.req.url).searchParams;
      const world = c.get("world");
      const checked = world.checkAuthorize(params);
      if ("error" in checked) {
        return errorPage(checked.error, checked.description, checked.status);
      }
      if (params.get("prompt") === "none") {
        return c.redirect(
          redirectWith(checked.redirectUri, params, { error: "interaction_required" }),
          302,
        );
      }
      return consentPage(world, checked.app, params, checked.scopes);
    });
    app.post(path, async (c) => {
      const form = new URLSearchParams(textFields(await c.req.formData()));
      const world = c.get("world");
      const checked = world.checkAuthorize(form);
      if ("error" in checked) {
        return errorPage(checked.error, checked.description, checked.status);
      }
      if (form.get("decision") !== "accept") {
        return c.redirect(redirectWith(checked.redirectUri, form, { error: "access_denied" }), 302);
      }
      const user = world.user(form.get("user_id"));
      if (!user) {
        return errorPage("invalid_request", "Choose an account to continue.");
      }
      const code = world.issueCode(
        checked.app,
        user,
        checked.scopes,
        checked.redirectUri,
        checked.offline,
      );
      return c.redirect(
        redirectWith(checked.redirectUri, form, {
          code,
          scope: checked.scopes.join(" "),
          authuser: "0",
          prompt: "consent",
        }),
        302,
      );
    });
  }

  app.get("/js/api.js", (c) => pickerScript(c.get("world").origins.accounts));
  app.get("/js/platform.js", (c) => pickerScript(c.get("world").origins.accounts));
  app.get("/picker", () => pickerPage());
  app.post("/picker/api/files", async (c) => pickerFiles(c));
  app.post("/picker/api/pick", async (c) => pickerPick(c));
  app.get("/avatar/:file", (c) => {
    const user = c.get("world").user(c.req.param("file").replace(/\.svg$/, ""));
    return user ? avatarSvg(user.name) : notFoundPage();
  });

  app.route("/", controlRoutes());

  app.get("/", (c) => {
    const world = c.get("world");
    const viewer = world.user(c.req.query("user")) ?? world.state.users[0];
    return viewer ? drivePage(world, viewer, null) : notFoundPage();
  });
  app.get("/drive/folders/:id", (c) => {
    const world = c.get("world");
    const viewer = world.user(c.req.query("user")) ?? world.state.users[0];
    return viewer ? drivePage(world, viewer, c.req.param("id")) : notFoundPage();
  });
  app.get("/embeddedfolderview", (c) => {
    const world = c.get("world");
    const viewer = world.user(c.req.query("user")) ?? world.state.users[0];
    return viewer ? drivePage(world, viewer, c.req.query("id") ?? null) : notFoundPage();
  });
  for (const kind of ["file", "document", "spreadsheets", "presentation"]) {
    app.get(`/${kind}/d/:id/*`, (c) => fileView(c, c.req.param("id")));
    app.get(`/${kind}/d/:id`, (c) => fileView(c, c.req.param("id")));
  }
  app.get("/uc", async (c) => {
    const world = c.get("world");
    const file = world.file(c.req.query("id") ?? "");
    if (!file || file.mime_type === FOLDER_MIME || isEditorMime(file.mime_type)) {
      return notFoundPage();
    }
    const bytes = (await world.content.get(file.id)) ?? new Uint8Array();
    return new Response(bytes, {
      headers: {
        "content-type": file.mime_type,
        "content-disposition": `attachment; filename="${file.name.replace(/"/g, "")}"`,
      },
    });
  });
  app.notFound(() => notFoundPage());
  return app;
}

async function fileView(c: AppContext, id: string): Promise<Response> {
  const world = c.get("world");
  const file = world.file(id);
  const viewer =
    world.user(c.req.query("user")) ??
    (file ? world.user(file.owner) : undefined) ??
    world.state.users[0];
  if (!file || !viewer || world.role(file, viewer.id) === null) {
    return notFoundPage();
  }
  if (file.mime_type === FOLDER_MIME) {
    return drivePage(world, viewer, file.id);
  }
  const bytes = await world.content.get(file.id);
  const text =
    bytes && looksLikeText(file.mime_type, bytes) ? new TextDecoder().decode(bytes) : null;
  return filePage(world, viewer, file, text);
}

function looksLikeText(mimeType: string, bytes: Uint8Array): boolean {
  if (
    isEditorMime(mimeType) ||
    mimeType.startsWith("text/") ||
    /json|xml|javascript|yaml|csv/.test(mimeType)
  ) {
    return true;
  }
  return !bytes.slice(0, 2048).includes(0);
}

type PickerView = { viewId: string; options: Record<string, unknown> };

function readView(value: unknown): PickerView {
  const view = (value ?? {}) as Partial<PickerView>;
  return {
    viewId: typeof view.viewId === "string" ? view.viewId : "all",
    options: view.options && typeof view.options === "object" ? view.options : {},
  };
}

const VIEW_MIMES: Record<string, (mimeType: string) => boolean> = {
  documents: (mimeType) => mimeType === "application/vnd.google-apps.document",
  spreadsheets: (mimeType) => mimeType === "application/vnd.google-apps.spreadsheet",
  presentations: (mimeType) => mimeType === "application/vnd.google-apps.presentation",
  pdfs: (mimeType) => mimeType === "application/pdf",
  "docs-images": (mimeType) => mimeType.startsWith("image/"),
  "docs-videos": (mimeType) => mimeType.startsWith("video/"),
  "docs-images-and-videos": (mimeType) =>
    mimeType.startsWith("image/") || mimeType.startsWith("video/"),
  folders: (mimeType) => mimeType === FOLDER_MIME,
};

function pickable(world: GoogleWorld, bearer: Bearer, view: PickerView, file: FileRecord): boolean {
  if (file.trashed || world.role(file, bearer.user.id) === null) {
    return false;
  }
  const folder = file.mime_type === FOLDER_MIME;
  const tree =
    view.viewId === "folders" ||
    Boolean(view.options.includeFolders) ||
    Boolean(view.options.selectFolder);
  if (folder) {
    return tree;
  }
  const mimeTypes =
    typeof view.options.mimeTypes === "string" ? view.options.mimeTypes.split(",") : null;
  if (mimeTypes && !mimeTypes.includes(file.mime_type)) {
    return false;
  }
  if (view.options.ownedByMe === true && file.owner !== bearer.user.id) {
    return false;
  }
  const matches = VIEW_MIMES[view.viewId];
  return matches ? matches(file.mime_type) : true;
}

function pickerError(c: AppContext, status: 400 | 401, message: string) {
  return c.json({ error: { message } }, status);
}

async function pickerAuth(c: AppContext) {
  const world = c.get("world");
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const bearer = world.bearer(c.req.header("authorization"));
  if (typeof bearer === "string") {
    return {
      error: pickerError(
        c,
        401,
        "The user is not signed in. Pass a valid OAuth token to setOAuthToken.",
      ),
    };
  }
  if (!world.canUseDrive(bearer)) {
    return { error: pickerError(c, 401, "The OAuth token doesn't have the drive.file scope.") };
  }
  if (!world.appByApiKey(typeof body.developerKey === "string" ? body.developerKey : null)) {
    return { error: pickerError(c, 400, "The API developer key is invalid.") };
  }
  return { world, bearer, body, view: readView(body.view) };
}

async function pickerFiles(c: AppContext) {
  const auth = await pickerAuth(c);
  if ("error" in auth) {
    return auth.error;
  }
  const { world, bearer, view } = auth;
  const files = world.data.files
    .filter((file) => pickable(world, bearer, view, file))
    .sort((a, b) => b.modified - a.modified)
    .map((file) => ({
      id: file.id,
      name: file.name,
      kind: kindOf(file.mime_type),
      folder: file.mime_type === FOLDER_MIME,
      parent_id: world.parentVisible(file, bearer.user) ? file.parent : null,
      mine: file.owner === bearer.user.id,
      owner: world.user(file.owner)?.name ?? "",
      modified: isoDate(file.modified),
    }));
  return c.json({ root_id: bearer.user.root_folder_id, files }, 200);
}

async function pickerPick(c: AppContext) {
  const auth = await pickerAuth(c);
  if ("error" in auth) {
    return auth.error;
  }
  const { world, bearer, body, view } = auth;
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string")
    : [];
  const files = ids.map((id) => world.file(id));
  if (ids.length === 0 || files.some((file) => !file || !pickable(world, bearer, view, file))) {
    return pickerError(c, 400, "Pick files you can see in this view.");
  }
  const appId =
    typeof body.appId === "string" || typeof body.appId === "number" ? String(body.appId) : null;
  const granted = appId === bearer.app.project_number;
  const docs = files.flatMap((file) => {
    if (!file) {
      return [];
    }
    if (granted) {
      world.grant(bearer.app, bearer.user, file);
    }
    return [world.pickerDoc(file, bearer.user, granted)];
  });
  return c.json(
    { action: "picked", viewToken: [view.viewId, null, viewOptions(view.options)], docs },
    200,
  );
}

function viewOptions(options: Record<string, unknown>): Record<string, unknown> {
  const { selectFolder, includeFolders, ...rest } = options;
  return {
    ...(selectFolder === undefined ? {} : { selectFolder }),
    ...(includeFolders === undefined ? {} : { includeFolders }),
    ...rest,
  };
}

function kindOf(mimeType: string): string {
  if (mimeType === FOLDER_MIME) {
    return "folder";
  }
  return mimeType.startsWith("application/vnd.google-apps.")
    ? mimeType.slice("application/vnd.google-apps.".length)
    : "file";
}

function apiRoutes(): Hono<Env> {
  const app = new Hono<Env>();
  app.use(async (c, next) => {
    const origin = c.req.header("origin");
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin ?? "*",
          "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
          "access-control-allow-headers":
            c.req.header("access-control-request-headers") ?? "authorization, content-type",
          "access-control-max-age": "3600",
          vary: "Origin",
        },
      });
    }
    await next();
    if (origin) {
      c.res.headers.set("access-control-allow-origin", origin);
      c.res.headers.set("access-control-expose-headers", "*");
      c.res.headers.append("vary", "Origin");
    }
  });

  for (const path of ["/token", "/o/oauth2/token"]) {
    app.post(path, async (c) => {
      const body = await readBody(c.req.raw);
      const world = c.get("world");
      const client = world.clientFor(
        body.client_id ?? basicClient(c)?.id,
        body.client_secret ?? basicClient(c)?.secret,
      );
      if ("error" in client) {
        const { status, ...error } = client;
        return c.json(error, status);
      }
      const result =
        body.grant_type === "authorization_code"
          ? world.exchangeCode(client, body.code ?? "", body.redirect_uri ?? "")
          : body.grant_type === "refresh_token"
            ? world.refresh(client, body.refresh_token ?? "")
            : ({
                error: "unsupported_grant_type",
                error_description: "Invalid grant_type: " + (body.grant_type ?? ""),
                status: 400,
              } as const);
      if ("error" in result) {
        const { status, ...error } = result;
        return c.json(error, status);
      }
      return c.json(result, 200);
    });
  }

  app.on(["GET", "POST"], "/revoke", async (c) => {
    const body = c.req.method === "POST" ? await readBody(c.req.raw) : {};
    const token = c.req.query("token") ?? body.token;
    if (!token || !c.get("world").revoke(token)) {
      return c.json({ error: "invalid_token", error_description: "Token expired or revoked" }, 400);
    }
    return c.json({}, 200);
  });

  for (const path of ["/tokeninfo", "/oauth2/v3/tokeninfo"]) {
    app.on(["GET", "POST"], path, async (c) => {
      const body = c.req.method === "POST" ? await readBody(c.req.raw) : {};
      const token = c.req.query("access_token") ?? body.access_token;
      const bearer = token ? c.get("world").accessToken(token) : undefined;
      return bearer
        ? c.json(c.get("world").tokenInfo(bearer), 200)
        : c.json({ error: "invalid_token", error_description: "Invalid Value" }, 400);
    });
  }

  for (const path of ["/oauth2/v3/userinfo", "/oauth2/v2/userinfo", "/userinfo/v2/me"]) {
    app.get(path, (c) => {
      const world = c.get("world");
      const bearer = world.bearer(
        c.req.header("authorization") ??
          (c.req.query("access_token") ? `Bearer ${c.req.query("access_token")}` : null),
      );
      if (
        typeof bearer === "string" ||
        !bearer.token.scopes.some((scope) => scope.includes("userinfo"))
      ) {
        return c.json({ error: "invalid_request", error_description: "Invalid Credentials" }, 401);
      }
      return c.json(world.userInfo(bearer), 200);
    });
  }

  app.route("/", drive());
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 404,
          message: "Not Found",
          errors: [{ message: "Not Found", domain: "global", reason: "notFound" }],
        },
      },
      404,
    ),
  );
  return app;
}

function controlRoutes() {
  return routes<Env>()
    .openapi(googleStateRoute, (c) => {
      const world = c.get("world");
      return c.json(
        {
          spec: world.state,
          files: world.data.files.map((file) => fileJson(world, file)),
          grants: world.data.grants.map((grant) => ({
            app: world.app(grant.client_id)?.name ?? grant.client_id,
            user: world.user(grant.user_id)?.email ?? grant.user_id,
            file: grant.file_id,
          })),
        },
        200,
      );
    })
    .openapi(createFileRoute, async (c) => {
      const world = c.get("world");
      const body = c.req.valid("json");
      const owner = world.user(body.owner);
      if (!owner) {
        return c.json(apiError("user_not_found", `No user ${body.owner} in this world.`), 400);
      }
      const parent = body.parent ? world.parentFor(body.parent, owner) : owner.root_folder_id;
      if (world.parentProblem(parent, owner)) {
        return c.json(
          apiError("parent_not_found", `${body.owner} can't add files to ${parent}.`),
          400,
        );
      }
      if (body.mime_type === FOLDER_MIME && body.content !== undefined) {
        return c.json(apiError("invalid_request", "Folders have no content."), 400);
      }
      const shares = [];
      for (const share of body.shared_with ?? []) {
        const user = world.user(share.user);
        if (!user) {
          return c.json(apiError("user_not_found", `No user ${share.user} in this world.`), 400);
        }
        shares.push({ user: user.id, role: share.role });
      }
      const file = await world.createFile(owner, {
        name: body.name,
        mime_type: body.mime_type,
        parent,
        content: body.content === undefined ? undefined : new TextEncoder().encode(body.content),
        shares,
      });
      return c.json(fileJson(world, file), 201);
    })
    .openapi(createGrantRoute, (c) => {
      const world = c.get("world");
      const body = c.req.valid("json");
      const app = world.app(body.app);
      const user = world.user(body.user);
      const file = world.file(body.file);
      if (!app) {
        return c.json(apiError("app_not_found", `No app ${body.app} in this world.`), 400);
      }
      if (!user) {
        return c.json(apiError("user_not_found", `No user ${body.user} in this world.`), 400);
      }
      if (!file || world.role(file, user.id) === null) {
        return c.json(
          apiError("file_not_found", `${body.user} can't see a file ${body.file}.`),
          400,
        );
      }
      world.grant(app, user, file);
      return c.json({ app: app.name, user: user.email, file: file.id }, 201);
    });
}

function fileJson(world: GoogleWorld, file: FileRecord) {
  return {
    id: file.id,
    name: file.name,
    mime_type: file.mime_type,
    owner: world.user(file.owner)?.email ?? file.owner,
    parent: file.parent,
    size: file.size,
    trashed: file.trashed,
    shared_with: file.shares.map((share) => ({
      user: world.user(share.user)?.email ?? share.user,
      role: share.role,
    })),
    created_at: isoDate(file.created),
    modified_at: isoDate(file.modified),
  };
}

function redirectWith(
  redirectUri: string,
  params: URLSearchParams,
  values: Record<string, string>,
): string {
  const url = new URL(redirectUri);
  const state = params.get("state");
  if (state !== null) {
    url.searchParams.set("state", state);
  }
  for (const [name, value] of Object.entries(values)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

function basicClient(c: AppContext): { id: string; secret: string } | null {
  const encoded = c.req.header("authorization")?.match(/^Basic\s+(\S+)$/i)?.[1];
  if (!encoded) {
    return null;
  }
  const [id, secret] = atob(encoded).split(":");
  return id && secret ? { id: decodeURIComponent(id), secret: decodeURIComponent(secret) } : null;
}

export async function readBody(request: Request): Promise<Record<string, string | undefined>> {
  if (request.headers.get("content-type")?.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(json ?? {}).map(([key, value]) => [
        key,
        typeof value === "string" ? value : undefined,
      ]),
    );
  }
  return Object.fromEntries(textFields(await request.formData().catch(() => new FormData())));
}

function textFields(form: FormData): [string, string][] {
  return [...form.entries()].flatMap(([name, value]) =>
    typeof value === "string" ? [[name, value] as [string, string]] : [],
  );
}
