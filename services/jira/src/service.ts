import { Hono, type Context } from "hono";

import { JiraDelivery } from "./delivery";
import { findUser, isAdf, type AccessToken, type JiraData, type Origins } from "./model";
import { consentPage, errorPage, issueListPage, issuePage } from "./pages";
import { JiraSite, randomToken, textOrAdf, type IssueInput, type IssuePatch } from "./site";
import {
  DEFAULT_JIRA_SPEC,
  ISSUE_STATUSES,
  OFFLINE_ACCESS,
  type IssueStatus,
  type JiraSpec,
  type JiraState,
} from "./spec";

export type JiraHost = "jira" | "jira-auth" | "jira-api";

export const JIRA_HOSTS: readonly JiraHost[] = ["jira", "jira-auth", "jira-api"];

const STATE_KEY = "jira";
const AUDIENCE = "api.atlassian.com";
const REST_PREFIX = "/ex/jira/:cloudId/rest/api/3";
const UNAUTHORIZED = { code: 401, message: "Unauthorized" };
const SCOPE_MISMATCH = { code: 401, message: "Unauthorized; scope does not match" };
const ISSUE_NOT_FOUND = {
  errorMessages: ["Issue does not exist or you do not have permission to see it."],
  errors: {},
};

type Env = { Variables: { site: JiraSite; token: AccessToken } };

export class JiraService {
  private site: JiraSite | null = null;
  private readonly delivery: JiraDelivery;
  private readonly apps: Record<JiraHost, Hono<Env>>;

  constructor(private readonly storage: DurableObjectStorage) {
    this.delivery = new JiraDelivery(
      storage,
      (clientId) => this.site?.app(clientId)?.credentials.client_secret ?? null,
    );
    this.apps = { jira: siteRoutes(), "jira-auth": authRoutes(), "jira-api": apiRoutes() };
  }

  async setup(spec: JiraSpec, origins: Origins): Promise<JiraState> {
    return (await this.load(origins, spec)).state;
  }

  async state(): Promise<JiraState | null> {
    return (await this.storage.get<JiraData>(STATE_KEY))?.state ?? null;
  }

  async fetch(request: Request, host: JiraHost, origins: Origins): Promise<Response> {
    const site = await this.load(origins);
    const app = new Hono<Env>();
    app.use(async (c, next) => {
      c.set("site", site);
      await next();
    });
    app.route("/", this.apps[host]);
    const response = await app.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") await this.save();
    return response;
  }

  async alarm(origins: Origins | null): Promise<void> {
    if (origins && (await this.storage.get(STATE_KEY))) await this.load(origins);
    await this.delivery.run();
  }

  nextDue(): Promise<number | null> {
    return this.delivery.nextDue();
  }

  private async load(origins: Origins, spec?: JiraSpec): Promise<JiraSite> {
    if (this.site) return this.site;
    const saved = await this.storage.get<JiraData>(STATE_KEY);
    this.site = new JiraSite(
      saved ?? emptyData(spec ?? DEFAULT_JIRA_SPEC, origins),
      origins,
      this.delivery,
    );
    if (!saved) {
      seedIssues(this.site, spec ?? DEFAULT_JIRA_SPEC);
      await this.save();
    }
    return this.site;
  }

  private async save(): Promise<void> {
    if (this.site) await this.storage.put<JiraData>(STATE_KEY, this.site.data);
  }
}

function emptyData(spec: JiraSpec, origins: Origins): JiraData {
  const users = (spec.users ?? []).map((user) => ({
    account_id: user.account_id ?? `712020:${crypto.randomUUID()}`,
    name: user.name,
    display_name: user.display_name ?? user.name,
    email: user.email ?? `${user.name}@${spec.site?.name ?? "worlds"}.test`,
    hide_email: user.hide_email ?? false,
  }));
  return {
    state: {
      site: {
        cloud_id: spec.site?.cloud_id ?? crypto.randomUUID(),
        name: spec.site?.name ?? "worlds",
        url: origins.site,
      },
      users,
      projects: (spec.projects ?? []).map((project, index) => ({
        id: project.id ?? String(10000 + index),
        key: project.key,
        name: project.name ?? project.key,
      })),
      issues: [],
      apps: (spec.apps ?? []).map((app) => ({
        name: app.name,
        callback_urls: app.callback_urls,
        scopes: app.scopes ?? [
          "read:jira-work",
          "write:jira-work",
          "read:jira-user",
          "manage:jira-webhook",
        ],
        credentials: {
          client_id: app.credentials?.client_id ?? randomToken(16),
          client_secret: app.credentials?.client_secret ?? randomToken(32),
        },
      })),
    },
    issues: [],
    sequence: { issue: 0, comment: 0, webhook: 0, changelog: 0 },
    codes: [],
    access_tokens: [],
    refresh_tokens: [],
    webhooks: [],
  };
}

function seedIssues(site: JiraSite, spec: JiraSpec): void {
  const accountId = (ref: string | undefined) =>
    ref ? (findUser(site.state, ref)?.account_id ?? null) : null;
  for (const issueSpec of spec.issues ?? []) {
    const issue = site.seedIssue(
      accountId(issueSpec.reporter) ?? site.state.users[0]?.account_id ?? "",
      {
        project: issueSpec.project,
        summary: issueSpec.summary,
        description: textOrAdf(issueSpec.description),
        labels: issueSpec.labels,
        status: issueSpec.status,
        assignee: accountId(issueSpec.assignee),
      },
    );
    for (const comment of issueSpec.comments ?? [])
      site.seedComment(
        issue,
        accountId(comment.author) ?? "",
        textOrAdf(comment.body) ?? { type: "doc", version: 1, content: [] },
      );
    site.state.issues.push({ ...issueSpec, key: issue.key });
  }
}

function authRoutes(): Hono<Env> {
  const app = new Hono<Env>();
  app.get("/authorize", (c) => {
    const checked = checkAuthorize(c.get("site"), new URL(c.req.url).searchParams);
    if ("error" in checked) return errorPage(checked.error);
    return consentPage(
      c.get("site").state,
      checked.app,
      new URL(c.req.url).searchParams,
      checked.scopes,
    );
  });
  app.post("/authorize", async (c) => {
    const form = new URLSearchParams(textFields(await c.req.formData()));
    const site = c.get("site");
    const checked = checkAuthorize(site, form);
    if ("error" in checked) return errorPage(checked.error);
    const redirect = new URL(form.get("redirect_uri") ?? "");
    const state = form.get("state");
    if (form.get("decision") !== "accept") {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "User did not authorize the request");
    } else {
      const user = site.state.users.find(
        (candidate) => candidate.account_id === form.get("account_id"),
      );
      if (!user) return errorPage("Choose a user to continue as.");
      redirect.searchParams.set(
        "code",
        site.issueCode(
          {
            client_id: checked.app.credentials.client_id,
            account_id: user.account_id,
            scopes: checked.scopes,
          },
          form.get("redirect_uri") ?? "",
        ),
      );
    }
    if (state !== null) redirect.searchParams.set("state", state);
    return c.redirect(redirect.toString(), 302);
  });
  app.post("/oauth/token", async (c) => {
    const body = await readBody(c.req.raw);
    const site = c.get("site");
    const app = site.app(body.client_id);
    if (!app || app.credentials.client_secret !== body.client_secret) {
      return c.json({ error: "access_denied", error_description: "Unauthorized" }, 401);
    }
    if (body.grant_type === "authorization_code") {
      const tokens = site.exchangeCode(app, body.code ?? "", body.redirect_uri ?? "");
      return tokens
        ? c.json(tokens)
        : c.json({ error: "invalid_grant", error_description: "Invalid authorization code" }, 403);
    }
    if (body.grant_type === "refresh_token") {
      const tokens = site.refresh(app, body.refresh_token ?? "");
      return tokens
        ? c.json(tokens)
        : c.json(
            { error: "unauthorized_client", error_description: "refresh_token is invalid" },
            403,
          );
    }
    return c.json(
      { error: "unsupported_grant_type", error_description: "Unsupported grant type" },
      400,
    );
  });
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}

function checkAuthorize(
  site: JiraSite,
  params: URLSearchParams,
): { app: NonNullable<ReturnType<JiraSite["app"]>>; scopes: string[] } | { error: string } {
  const app = site.app(params.get("client_id"));
  if (!app) return { error: "The app's client_id is not valid." };
  if (params.get("audience") !== AUDIENCE) return { error: `audience must be ${AUDIENCE}.` };
  if (params.get("response_type") !== "code") return { error: "response_type must be code." };
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!app.callback_urls.some((registered) => callbackMatches(registered, redirectUri))) {
    return { error: "The redirect_uri is not one of the app's callback URLs." };
  }
  const scopes = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);
  const allowed = new Set<string>([...app.scopes, OFFLINE_ACCESS]);
  const unknown = scopes.find((scope) => !allowed.has(scope));
  if (scopes.length === 0 || unknown)
    return {
      error: unknown ? `The app hasn't been granted the scope ${unknown}.` : "scope is required.",
    };
  return { app, scopes };
}

function callbackMatches(registered: string, incoming: string): boolean {
  if (!URL.canParse(incoming) || !URL.canParse(registered.replaceAll("*", "x"))) return false;
  const expected = new URL(registered.replaceAll("*", "x"));
  const url = new URL(incoming);
  const host = new RegExp(
    `^${registered
      .replace(/^https?:\/\//, "")
      .split(/[/:]/)[0]
      ?.split("*")
      .map(escapeRegExp)
      .join("[a-z0-9-]+")}$`,
  );
  return (
    url.protocol === expected.protocol &&
    host.test(url.hostname) &&
    url.port === expected.port &&
    url.pathname === expected.pathname
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function apiRoutes(): Hono<Env> {
  const app = new Hono<Env>();
  app.get("/oauth/token/accessible-resources", (c) => {
    const site = c.get("site");
    const token = site.authenticate(c.req.header("authorization") ?? null);
    if (!token) return c.json(UNAUTHORIZED, 401);
    return c.json([
      {
        id: site.state.site.cloud_id,
        url: site.state.site.url,
        name: site.state.site.name,
        scopes: token.scopes.filter((scope) => scope !== OFFLINE_ACCESS),
        avatarUrl: "https://site-admin-avatar-cdn.prod.public.atl-paas.net/avatars/240/rocket.png",
      },
    ]);
  });

  const rest = new Hono<Env>();
  rest.use(async (c, next) => {
    const site = c.get("site");
    if (c.req.param("cloudId") !== site.state.site.cloud_id)
      return c.json({ code: 404, message: "Not Found" }, 404);
    const token = site.authenticate(c.req.header("authorization") ?? null);
    if (!token) return c.json(UNAUTHORIZED, 401);
    c.set("token", token);
    await next();
  });
  const requireScope = (scope: string) => async (c: Context<Env>, next: () => Promise<void>) => {
    if (!c.get("token").scopes.includes(scope)) return c.json(SCOPE_MISMATCH, 401);
    await next();
  };

  rest.get("/issue/:idOrKey", requireScope("read:jira-work"), (c) => {
    const site = c.get("site");
    const issue = site.issue(c.req.param("idOrKey") ?? "");
    return issue ? c.json(site.json.issue(issue, "api")) : c.json(ISSUE_NOT_FOUND, 404);
  });
  rest.post("/issue/:idOrKey/comment", requireScope("write:jira-work"), async (c) => {
    const site = c.get("site");
    const issue = site.issue(c.req.param("idOrKey") ?? "");
    if (!issue) return c.json(ISSUE_NOT_FOUND, 404);
    const body = (await c.req.json().catch(() => null)) as { body?: unknown } | null;
    if (!isAdf(body?.body))
      return c.json({ errorMessages: [], errors: { comment: "Comment body is not valid!" } }, 400);
    const comment = await site.addComment(c.get("token").account_id, issue, body.body);
    return c.json(site.json.comment(issue, comment, "api"), 201);
  });
  rest.get("/user", requireScope("read:jira-user"), (c) => {
    const site = c.get("site");
    const user = site.json.user(c.req.query("accountId") ?? "", "api");
    return user
      ? c.json(user)
      : c.json(
          {
            errorMessages: [
              "Specified user does not exist or you do not have required permissions",
            ],
            errors: {},
          },
          404,
        );
  });
  rest.get("/myself", requireScope("read:jira-user"), (c) =>
    c.json(c.get("site").json.user(c.get("token").account_id, "api")),
  );

  rest.get("/webhook", requireScope("manage:jira-webhook"), (c) => {
    const webhooks = c.get("site").webhooksFor(c.get("token"));
    const startAt = Number(c.req.query("startAt") ?? 0) || 0;
    const maxResults = Math.min(Number(c.req.query("maxResults") ?? 100) || 100, 100);
    const values = webhooks.slice(startAt, startAt + maxResults).map((webhook) => ({
      id: webhook.id,
      jqlFilter: webhook.jql,
      events: webhook.events,
      expirationDate: webhook.expires_at,
      url: webhook.url,
    }));
    return c.json({
      maxResults,
      startAt,
      total: webhooks.length,
      isLast: startAt + values.length >= webhooks.length,
      values,
    });
  });
  rest.post("/webhook", requireScope("manage:jira-webhook"), async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      url?: unknown;
      webhooks?: unknown;
    } | null;
    if (
      typeof body?.url !== "string" ||
      !URL.canParse(body.url) ||
      !Array.isArray(body.webhooks) ||
      body.webhooks.length === 0
    ) {
      return c.json({ errorMessages: ["url and webhooks are required."], errors: {} }, 400);
    }
    return c.json({
      webhookRegistrationResult: c
        .get("site")
        .registerWebhooks(c.get("token"), body.url, body.webhooks),
    });
  });
  rest.delete("/webhook", requireScope("manage:jira-webhook"), async (c) => {
    const ids = webhookIds(await c.req.json().catch(() => null));
    if (!ids) return c.json({ errorMessages: ["webhookIds are required."], errors: {} }, 400);
    c.get("site").deleteWebhooks(c.get("token"), ids);
    return c.body(null, 202);
  });
  rest.put("/webhook/refresh", requireScope("manage:jira-webhook"), async (c) => {
    const ids = webhookIds(await c.req.json().catch(() => null));
    if (!ids) return c.json({ errorMessages: ["webhookIds are required."], errors: {} }, 400);
    return c.json({ expirationDate: c.get("site").refreshWebhooks(c.get("token"), ids) });
  });
  rest.notFound((c) => c.json({ errorMessages: ["Not found"], errors: {} }, 404));

  app.route(REST_PREFIX, rest);
  app.notFound((c) => c.json({ code: 404, message: "Not Found" }, 404));
  return app;
}

function webhookIds(body: unknown): number[] | null {
  const ids = (body as { webhookIds?: unknown } | null)?.webhookIds;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return ids.map(Number).filter(Number.isFinite);
}

function siteRoutes(): Hono<Env> {
  const app = new Hono<Env>();
  app.get("/", (c) => issueListPage(c.get("site").state, c.get("site").data.issues));
  app.get("/browse/:key", (c) => {
    const issue = c.get("site").issue(c.req.param("key"));
    return issue ? issuePage(c.get("site").state, issue) : errorPage("Issue does not exist.", 404);
  });
  app.all("/rest/*", (c) =>
    c.json(
      { errorMessages: ["Client must be authenticated to access this resource."], errors: {} },
      401,
    ),
  );

  app.get("/_worlds/jira/state", async (c) => {
    const site = c.get("site");
    return c.json({
      spec: site.state,
      issues: site.data.issues.map((issue) => site.json.issue(issue, "api")),
      webhooks: site.data.webhooks.map(
        ({ id, client_id, account_id, url, jql, events, expires_at }) => ({
          id,
          client_id,
          account_id,
          url,
          jql,
          events,
          expires_at,
        }),
      ),
    });
  });
  app.post("/_worlds/jira/issues", async (c) => {
    const site = c.get("site");
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const actor = actorOf(site, body.user);
    if (!actor) return c.json({ error: "user_not_found" }, 400);
    const project = typeof body.project === "string" ? body.project : site.state.projects[0]?.key;
    if (!project || !site.state.projects.some((candidate) => candidate.key === project))
      return c.json({ error: "project_not_found" }, 400);
    if (typeof body.summary !== "string" || !body.summary.trim())
      return c.json({ error: "summary_required" }, 400);
    const fields = issueFields(site, body);
    if ("error" in fields) return c.json(fields, 400);
    const issue = await site.createIssue(actor, {
      ...fields,
      project,
      summary: body.summary,
    } as IssueInput);
    return c.json(site.json.issue(issue, "api"), 201);
  });
  app.patch("/_worlds/jira/issues/:key", async (c) => {
    const site = c.get("site");
    const issue = site.issue(c.req.param("key"));
    if (!issue) return c.json(ISSUE_NOT_FOUND, 404);
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const actor = actorOf(site, body.user);
    if (!actor) return c.json({ error: "user_not_found" }, 400);
    const fields = issueFields(site, body);
    if ("error" in fields) return c.json(fields, 400);
    const changelog = await site.updateIssue(actor, issue, fields);
    return c.json({ issue: site.json.issue(issue, "api"), changelog });
  });
  app.delete("/_worlds/jira/issues/:key", async (c) => {
    const site = c.get("site");
    const issue = site.issue(c.req.param("key"));
    if (!issue) return c.json(ISSUE_NOT_FOUND, 404);
    const actor = actorOf(site, c.req.query("user"));
    if (!actor) return c.json({ error: "user_not_found" }, 400);
    await site.deleteIssue(actor, issue);
    return c.body(null, 204);
  });
  app.post("/_worlds/jira/issues/:key/comments", async (c) => {
    const site = c.get("site");
    const issue = site.issue(c.req.param("key"));
    if (!issue) return c.json(ISSUE_NOT_FOUND, 404);
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const actor = actorOf(site, body.user);
    if (!actor) return c.json({ error: "user_not_found" }, 400);
    const adf = textOrAdf(body.body);
    if (!adf || !isAdf(adf)) return c.json({ error: "body_required" }, 400);
    const comment = await site.addComment(actor, issue, adf);
    return c.json(site.json.comment(issue, comment, "api"), 201);
  });
  app.notFound(() => errorPage("Page not found.", 404));
  return app;
}

function actorOf(site: JiraSite, ref: unknown): string | null {
  if (ref === undefined || ref === null || ref === "")
    return site.state.users[0]?.account_id ?? null;
  return typeof ref === "string" ? (findUser(site.state, ref)?.account_id ?? null) : null;
}

function issueFields(
  site: JiraSite,
  body: Record<string, unknown>,
): IssuePatch | { error: string } {
  const fields: IssuePatch = {};
  if (body.summary !== undefined) {
    if (typeof body.summary !== "string" || !body.summary.trim())
      return { error: "summary_required" };
    fields.summary = body.summary;
  }
  if (body.description !== undefined) fields.description = textOrAdf(body.description) ?? null;
  if (body.labels !== undefined) {
    if (
      !Array.isArray(body.labels) ||
      body.labels.some((label) => typeof label !== "string" || /\s/.test(label))
    )
      return { error: "labels_invalid" };
    fields.labels = body.labels as string[];
  }
  if (body.status !== undefined) {
    if (!ISSUE_STATUSES.includes(body.status as IssueStatus)) return { error: "status_invalid" };
    fields.status = body.status as IssueStatus;
  }
  if (body.assignee !== undefined) {
    if (body.assignee === null) fields.assignee = null;
    else {
      const user =
        typeof body.assignee === "string" ? findUser(site.state, body.assignee) : undefined;
      if (!user) return { error: "assignee_not_found" };
      fields.assignee = user.account_id;
    }
  }
  return fields;
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
