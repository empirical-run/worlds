import { apiError, routes, type ApiError } from "@worlds/contract";
import { Hono } from "hono";

import {
  createCommentRoute,
  createIssueRoute,
  linearStateRoute,
  revokeAppRoute,
  updateIssueRoute,
  type LinearHost,
} from "./contract";
import { LinearDelivery } from "./delivery";
import { runGraphql } from "./graphql";
import { isoDate, randomToken, type Issue, type LinearData, type Origins } from "./model";
import { consentPage, errorPage, issueListPage, issuePage } from "./pages";
import { APP_ONLY_SCOPES, type LinearAppState, type LinearSpec, type LinearState } from "./spec";
import { LinearWorkspace, type IssuePatch } from "./workspace";

const STATE_KEY = "linear";
const DEFAULT_SCOPE = "read";

type Env = { Variables: { workspace: LinearWorkspace } };

export class LinearNotSetUp extends Error {
  constructor() {
    super("linear_not_set_up");
  }
}

export class LinearService {
  private workspace: LinearWorkspace | null = null;
  private readonly delivery: LinearDelivery;
  private readonly apps: Record<LinearHost, Hono<Env>>;

  constructor(private readonly storage: DurableObjectStorage) {
    this.delivery = new LinearDelivery(
      storage,
      (clientId) => this.workspace?.app(clientId)?.credentials.webhook_secret ?? null,
    );
    this.apps = { linear: appRoutes(), "linear-api": apiRoutes() };
  }

  async setup(spec: LinearSpec, origins: Origins): Promise<LinearState> {
    return (await this.load(origins, spec)).state;
  }

  async state(): Promise<LinearState | null> {
    return (await this.storage.get<LinearData>(STATE_KEY))?.state ?? null;
  }

  async fetch(request: Request, host: LinearHost, origins: Origins): Promise<Response> {
    const workspace = await this.load(origins);
    const app = new Hono<Env>();
    app.use(async (c, next) => {
      c.set("workspace", workspace);
      await next();
    });
    app.route("/", this.apps[host]);
    const response = await app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      await this.save();
    }
    return response;
  }

  async alarm(origins: Origins | null): Promise<void> {
    if (origins && (await this.storage.get(STATE_KEY))) {
      await this.load(origins);
    }
    await this.delivery.run();
  }

  nextDue(): Promise<number | null> {
    return this.delivery.nextDue();
  }

  private async load(origins: Origins, spec?: LinearSpec): Promise<LinearWorkspace> {
    if (this.workspace) {
      return this.workspace;
    }
    const saved = await this.storage.get<LinearData>(STATE_KEY);
    if (saved) {
      this.workspace = new LinearWorkspace(saved, origins, this.delivery);
      return this.workspace;
    }
    if (!spec) {
      throw new LinearNotSetUp();
    }
    this.workspace = new LinearWorkspace(emptyData(spec, origins), origins, this.delivery);
    seedIssues(this.workspace, spec);
    await this.save();
    return this.workspace;
  }

  private async save(): Promise<void> {
    if (this.workspace) {
      await this.storage.put<LinearData>(STATE_KEY, this.workspace.data);
    }
  }
}

function emptyData(spec: LinearSpec, origins: Origins): LinearData {
  return {
    state: {
      workspace: {
        id: spec.workspace.id ?? crypto.randomUUID(),
        name: spec.workspace.name,
        url_key: spec.workspace.url_key,
        url: `${origins.app}/${spec.workspace.url_key}`,
      },
      users: (spec.users ?? []).map((user) => ({
        id: user.id ?? crypto.randomUUID(),
        name: user.name,
        display_name: user.display_name,
        email: user.email,
      })),
      teams: (spec.teams ?? []).map((team) => ({
        id: team.id ?? crypto.randomUUID(),
        key: team.key,
        name: team.name,
      })),
      issues: [],
      apps: (spec.apps ?? []).map((app) => ({
        name: app.name,
        callback_urls: app.callback_urls,
        scopes: app.scopes,
        webhook_url: app.webhook_url ?? null,
        credentials: {
          client_id: app.credentials?.client_id ?? randomToken(16),
          client_secret: app.credentials?.client_secret ?? randomToken(32),
          webhook_secret: app.credentials?.webhook_secret ?? `lin_wh_${randomToken(24)}`,
        },
      })),
    },
    issues: [],
    app_users: [],
    sync_id: 1000,
    codes: [],
    access_tokens: [],
    refresh_tokens: [],
  };
}

function seedIssues(workspace: LinearWorkspace, spec: LinearSpec): void {
  const userId = (ref: string) => {
    const user = workspace.member(ref);
    if (!user) {
      throw new Error(`linear spec: unknown user ${ref}`);
    }
    return user.id;
  };
  for (const issueSpec of spec.issues ?? []) {
    const issue = workspace.seedIssue(userId(issueSpec.creator), {
      team: issueSpec.team,
      title: issueSpec.title,
      description: issueSpec.description,
      state: issueSpec.state,
      assignee: issueSpec.assignee ? userId(issueSpec.assignee) : null,
    });
    for (const comment of issueSpec.comments ?? []) {
      workspace.addComment(issue, userId(comment.author), comment.body);
    }
    workspace.state.issues.push({ ...issueSpec, identifier: issue.identifier });
  }
}

type Authorization = { app: LinearAppState; scopes: string[]; actor: "user" | "app" };

function checkAuthorize(
  workspace: LinearWorkspace,
  params: URLSearchParams,
): Authorization | { error: string } {
  const app = workspace.app(params.get("client_id"));
  if (!app) {
    return { error: "Invalid client_id: the OAuth application doesn't exist." };
  }
  if (params.get("response_type") !== "code") {
    return { error: "response_type must be code." };
  }
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!app.callback_urls.some((registered) => callbackMatches(registered, redirectUri))) {
    return { error: "Invalid redirect_uri: it isn't one of the application's callback URLs." };
  }
  const actor = params.get("actor") === "app" ? "app" : "user";
  const scopes = (params.get("scope") ?? DEFAULT_SCOPE).split(/[\s,]+/).filter(Boolean);
  const allowed = new Set<string>(app.scopes);
  const unknown = scopes.find((scope) => !allowed.has(scope));
  if (scopes.length === 0 || unknown) {
    return { error: unknown ? `Invalid scope: ${unknown}` : "scope is required." };
  }
  if (actor === "user" && scopes.some((scope) => APP_ONLY_SCOPES.includes(scope))) {
    return { error: "app:assignable and app:mentionable require actor=app." };
  }
  if (actor === "app" && scopes.includes("admin")) {
    return { error: "Applications using actor=app can't request the admin scope." };
  }
  return { app, scopes, actor };
}

function callbackMatches(registered: string, incoming: string): boolean {
  if (!URL.canParse(incoming) || !URL.canParse(registered.replaceAll("*", "x"))) {
    return false;
  }
  const expected = new URL(registered.replaceAll("*", "x"));
  const url = new URL(incoming);
  const host = new RegExp(
    `^${registered
      .replace(/^https?:\/\//, "")
      .split(/[/:]/)[0]
      ?.split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[a-z0-9-]+")}$`,
  );
  return (
    url.protocol === expected.protocol &&
    host.test(url.hostname) &&
    url.port === expected.port &&
    url.pathname === expected.pathname
  );
}

function appRoutes(): Hono<Env> {
  const app = new Hono<Env>();
  app.get("/oauth/authorize", (c) => {
    const params = new URL(c.req.url).searchParams;
    const checked = checkAuthorize(c.get("workspace"), params);
    return "error" in checked
      ? errorPage(checked.error)
      : consentPage(c.get("workspace"), checked.app, params, checked.scopes);
  });
  app.post("/oauth/authorize", async (c) => {
    const form = new URLSearchParams(textFields(await c.req.formData()));
    const workspace = c.get("workspace");
    const checked = checkAuthorize(workspace, form);
    if ("error" in checked) {
      return errorPage(checked.error);
    }
    const redirect = new URL(form.get("redirect_uri") ?? "");
    if (form.get("decision") !== "accept") {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "The user denied the request");
    } else {
      const user = workspace.state.users.find((candidate) => candidate.id === form.get("user_id"));
      if (!user) {
        return errorPage("Choose who to authorize as.");
      }
      const viewer =
        checked.actor === "app"
          ? workspace.installAppUser(checked.app, checked.scopes).id
          : user.id;
      redirect.searchParams.set(
        "code",
        workspace.issueCode(
          {
            client_id: checked.app.credentials.client_id,
            user_id: viewer,
            scopes: checked.scopes,
            actor: checked.actor,
          },
          form.get("redirect_uri") ?? "",
        ),
      );
    }
    const state = form.get("state");
    if (state !== null) {
      redirect.searchParams.set("state", state);
    }
    return c.redirect(redirect.toString(), 302);
  });

  app.route("/", controlRoutes());

  app.get("/", (c) => issueListPage(c.get("workspace"), null));
  app.get("/:urlKey/team/:key/*", (c) => {
    const workspace = c.get("workspace");
    if (c.req.param("urlKey") !== workspace.state.workspace.url_key) {
      return errorPage("Workspace not found.", 404);
    }
    return workspace.team(c.req.param("key"))
      ? issueListPage(workspace, c.req.param("key"))
      : errorPage("Team not found.", 404);
  });
  app.get("/:urlKey/issue/:identifier/*", (c) => issueResponse(c.get("workspace"), c.req.param()));
  app.get("/:urlKey/issue/:identifier", (c) => issueResponse(c.get("workspace"), c.req.param()));
  app.get("/:urlKey", (c) =>
    c.req.param("urlKey") === c.get("workspace").state.workspace.url_key
      ? issueListPage(c.get("workspace"), null)
      : errorPage("Workspace not found.", 404),
  );
  app.notFound(() => errorPage("Page not found.", 404));
  return app;
}

function issueResponse(
  workspace: LinearWorkspace,
  params: { urlKey?: string; identifier?: string },
): Response {
  const issue =
    params.urlKey === workspace.state.workspace.url_key
      ? workspace.issue(params.identifier ?? "")
      : undefined;
  return issue ? issuePage(workspace, issue) : errorPage("Issue not found.", 404);
}

function apiRoutes(): Hono<Env> {
  const app = new Hono<Env>();
  app.post("/graphql", async (c) => {
    const body = await c.req.json().catch(() => null);
    const result = await runGraphql(
      c.get("workspace"),
      body,
      c.req.header("authorization") ?? null,
    );
    return c.json(result.body, result.status as 200);
  });
  app.post("/oauth/token", async (c) => {
    const body = await readBody(c.req.raw);
    const workspace = c.get("workspace");
    const app = workspace.app(body.client_id);
    if (!app || app.credentials.client_secret !== body.client_secret) {
      return c.json(
        { error: "invalid_client", error_description: "Invalid client: client is invalid" },
        400,
      );
    }
    const tokens =
      body.grant_type === "authorization_code"
        ? workspace.exchangeCode(app, body.code ?? "", body.redirect_uri ?? "")
        : body.grant_type === "refresh_token"
          ? workspace.refresh(app, body.refresh_token ?? "")
          : {
              error: "unsupported_grant_type",
              error_description: "Unsupported grant type: grant_type is invalid",
            };
    return c.json(tokens, "error" in tokens ? 400 : 200);
  });
  app.post("/oauth/revoke", async (c) => {
    const body = await readBody(c.req.raw);
    const bearer = c.req
      .header("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim();
    const token = body.token ?? body.access_token ?? bearer;
    if (!token) {
      return c.json(
        {
          error:
            "Unable to read token. Please supply the `token` field (optionally with `token_type_hint`) or use the Bearer or DPoP token in the `authorization` header.",
        },
        401,
      );
    }
    const result = c.get("workspace").revokeToken(token);
    if (result === "not_found") {
      return c.json({ error: "Token not found" }, 401);
    }
    if (result === "already_revoked") {
      return c.json({ error: "Token has already been revoked" }, 400);
    }
    return c.body(null, 200);
  });
  app.notFound((c) => c.json({ error: "Not found" }, 404));
  return app;
}

function issueJson(workspace: LinearWorkspace, issue: Issue) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    url: workspace.issueUrl(issue),
    state: issue.state,
    team: issue.team,
    creator: issue.creator,
    assignee: issue.assignee,
    created_at: isoDate(issue.created),
    updated_at: isoDate(issue.updated),
    comments: issue.comments.map((comment) => ({
      id: comment.id,
      user: comment.user,
      body: comment.body,
      created_at: isoDate(comment.created),
    })),
    reactions: issue.reactions.map(({ id, user, emoji }) => ({ id, user, emoji })),
    attachments: issue.attachments.map(({ id, title, subtitle, url }) => ({
      id,
      title,
      subtitle,
      url,
    })),
  };
}

function controlRoutes() {
  return routes<Env>()
    .openapi(linearStateRoute, (c) => {
      const workspace = c.get("workspace");
      return c.json(
        {
          spec: workspace.state,
          issues: workspace.data.issues.map((issue) => issueJson(workspace, issue)),
          app_users: workspace.data.app_users
            .filter((user) => user.active)
            .map(({ id, client_id, name, handle }) => ({
              id,
              client_id,
              name,
              handle,
            })),
        },
        200,
      );
    })
    .openapi(createIssueRoute, async (c) => {
      const workspace = c.get("workspace");
      const body = c.req.valid("json");
      const actor = workspace.member(body.user);
      if (!actor) {
        return c.json(unknownUser(body.user), 400);
      }
      if (!workspace.team(body.team)) {
        return c.json(apiError("team_not_found", `No team with key ${body.team}.`), 400);
      }
      const assignee = body.assignee ? workspace.assignable(body.assignee) : null;
      if (assignee && typeof assignee !== "string") {
        return c.json(apiError("user_not_found", assignee.error), 400);
      }
      const issue = await workspace.createIssue(actor.id, {
        team: body.team,
        title: body.title,
        description: body.description ?? null,
        state: body.state,
        assignee,
      });
      return c.json(issueJson(workspace, issue), 201);
    })
    .openapi(updateIssueRoute, async (c) => {
      const workspace = c.get("workspace");
      const { identifier } = c.req.valid("param");
      const body = c.req.valid("json");
      const issue = workspace.issue(identifier);
      if (!issue) {
        return c.json(issueNotFound(identifier), 404);
      }
      const actor = workspace.member(body.user);
      if (!actor) {
        return c.json(unknownUser(body.user), 400);
      }
      const patch: IssuePatch = {
        title: body.title,
        description: body.description,
        state: body.state,
      };
      if (body.assignee === null) {
        patch.assignee = null;
      } else if (body.assignee !== undefined) {
        const assignee = workspace.assignable(body.assignee);
        if (typeof assignee !== "string") {
          return c.json(apiError("user_not_found", assignee.error), 400);
        }
        patch.assignee = assignee;
      }
      await workspace.updateIssue(actor.id, issue, patch);
      return c.json(issueJson(workspace, issue), 200);
    })
    .openapi(createCommentRoute, (c) => {
      const workspace = c.get("workspace");
      const { identifier } = c.req.valid("param");
      const body = c.req.valid("json");
      const issue = workspace.issue(identifier);
      if (!issue) {
        return c.json(issueNotFound(identifier), 404);
      }
      const actor = workspace.member(body.user);
      if (!actor) {
        return c.json(unknownUser(body.user), 400);
      }
      workspace.addComment(issue, actor.id, body.body);
      return c.json(issueJson(workspace, issue), 201);
    })
    .openapi(revokeAppRoute, async (c) => {
      const workspace = c.get("workspace");
      const { client_id } = c.req.valid("param");
      const app = workspace.app(client_id);
      if (!app) {
        return c.json(apiError("app_not_found", `No app with client id ${client_id}.`), 404);
      }
      await workspace.uninstall(app);
      return c.body(null, 204);
    });
}

function unknownUser(ref: string): ApiError {
  return apiError("user_not_found", `No member named ${ref} in this world.`);
}

function issueNotFound(identifier: string): ApiError {
  return apiError("issue_not_found", `No issue ${identifier} in this world.`);
}

async function readBody(request: Request): Promise<Record<string, string | undefined>> {
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
