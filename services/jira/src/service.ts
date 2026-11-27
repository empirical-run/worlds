import { apiError, routes, type ApiError } from "@worlds/contract";
import { Hono, type Context } from "hono";

import {
  createCommentRoute,
  createIssueRoute,
  deleteIssueRoute,
  jiraStateRoute,
  updateIssueRoute,
  type JiraHost,
} from "./contract";
import { JiraDelivery } from "./delivery";
import {
  findUser,
  isAdf,
  textToAdf,
  type AccessToken,
  type Adf,
  type JiraData,
  type Origins,
} from "./model";
import { consentPage, errorPage, issueListPage, issuePage } from "./pages";
import { JiraSite, randomToken, textOrAdf, type IssuePatch } from "./site";
import { OFFLINE_ACCESS, type IssueStatus, type JiraSpec, type JiraState } from "./spec";

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

export class JiraNotSetUp extends Error {
  constructor() {
    super("jira_not_set_up");
  }
}

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

  private async load(origins: Origins, spec?: JiraSpec): Promise<JiraSite> {
    if (this.site) {
      return this.site;
    }
    const saved = await this.storage.get<JiraData>(STATE_KEY);
    if (saved) {
      this.site = new JiraSite(saved, origins, this.delivery);
      return this.site;
    }
    if (!spec) {
      throw new JiraNotSetUp();
    }
    this.site = new JiraSite(emptyData(spec, origins), origins, this.delivery);
    seedIssues(this.site, spec);
    await this.save();
    return this.site;
  }

  private async save(): Promise<void> {
    if (this.site) {
      await this.storage.put<JiraData>(STATE_KEY, this.site.data);
    }
  }
}

function emptyData(spec: JiraSpec, origins: Origins): JiraData {
  const users = (spec.users ?? []).map((user) => ({
    account_id: user.account_id ?? `712020:${crypto.randomUUID()}`,
    name: user.name,
    display_name: user.display_name,
    email: user.email,
    hide_email: user.hide_email ?? false,
  }));
  return {
    state: {
      site: {
        cloud_id: spec.site.cloud_id ?? crypto.randomUUID(),
        name: spec.site.name,
        url: origins.site,
      },
      users,
      projects: (spec.projects ?? []).map((project, index) => ({
        id: project.id ?? String(10000 + index),
        key: project.key,
        name: project.name,
      })),
      issues: [],
      apps: (spec.apps ?? []).map((app) => ({
        name: app.name,
        callback_urls: app.callback_urls,
        scopes: app.scopes,
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
  const accountId = (ref: string) => {
    const user = findUser(site.state, ref);
    if (!user) {
      throw new Error(`jira spec: unknown user ${ref}`);
    }
    return user.account_id;
  };
  for (const issueSpec of spec.issues ?? []) {
    const issue = site.seedIssue(accountId(issueSpec.reporter), {
      project: issueSpec.project,
      summary: issueSpec.summary,
      description: textOrAdf(issueSpec.description),
      labels: issueSpec.labels,
      status: issueSpec.status,
      assignee: issueSpec.assignee ? accountId(issueSpec.assignee) : null,
    });
    for (const comment of issueSpec.comments ?? []) {
      site.seedComment(issue, accountId(comment.author), textToAdf(comment.body));
    }
    site.state.issues.push({ ...issueSpec, key: issue.key });
  }
}

function authRoutes(): Hono<Env> {
  const app = new Hono<Env>();
  app.get("/authorize", (c) => {
    const checked = checkAuthorize(c.get("site"), new URL(c.req.url).searchParams);
    if ("error" in checked) {
      return errorPage(checked.error);
    }
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
    if ("error" in checked) {
      return errorPage(checked.error);
    }
    const redirect = new URL(form.get("redirect_uri") ?? "");
    const state = form.get("state");
    if (form.get("decision") !== "accept") {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "User did not authorize the request");
    } else {
      const user = site.state.users.find(
        (candidate) => candidate.account_id === form.get("account_id"),
      );
      if (!user) {
        return errorPage("Choose a user to continue as.");
      }
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
    if (state !== null) {
      redirect.searchParams.set("state", state);
    }
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
  if (!app) {
    return { error: "The app's client_id is not valid." };
  }
  if (params.get("audience") !== AUDIENCE) {
    return { error: `audience must be ${AUDIENCE}.` };
  }
  if (params.get("response_type") !== "code") {
    return { error: "response_type must be code." };
  }
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!app.callback_urls.some((registered) => callbackMatches(registered, redirectUri))) {
    return { error: "The redirect_uri is not one of the app's callback URLs." };
  }
  const scopes = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);
  const allowed = new Set<string>([...app.scopes, OFFLINE_ACCESS]);
  const unknown = scopes.find((scope) => !allowed.has(scope));
  if (scopes.length === 0 || unknown) {
    return {
      error: unknown ? `The app hasn't been granted the scope ${unknown}.` : "scope is required.",
    };
  }
  return { app, scopes };
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
    if (!token) {
      return c.json(UNAUTHORIZED, 401);
    }
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
    if (c.req.param("cloudId") !== site.state.site.cloud_id) {
      return c.json({ code: 404, message: "Not Found" }, 404);
    }
    const token = site.authenticate(c.req.header("authorization") ?? null);
    if (!token) {
      return c.json(UNAUTHORIZED, 401);
    }
    c.set("token", token);
    await next();
  });
  const requireScope = (scope: string) => async (c: Context<Env>, next: () => Promise<void>) => {
    if (!c.get("token").scopes.includes(scope)) {
      return c.json(SCOPE_MISMATCH, 401);
    }
    await next();
  };

  rest.get("/issue/:idOrKey", requireScope("read:jira-work"), (c) => {
    const site = c.get("site");
    const issue = site.issue(c.req.param("idOrKey") ?? "");
    return issue ? c.json(site.json.apiIssue(issue)) : c.json(ISSUE_NOT_FOUND, 404);
  });
  rest.post("/issue/:idOrKey/comment", requireScope("write:jira-work"), async (c) => {
    const site = c.get("site");
    const issue = site.issue(c.req.param("idOrKey") ?? "");
    if (!issue) {
      return c.json(ISSUE_NOT_FOUND, 404);
    }
    const body = (await c.req.json().catch(() => null)) as { body?: unknown } | null;
    if (!isAdf(body?.body)) {
      return c.json({ errorMessages: [], errors: { comment: "Comment body is not valid!" } }, 400);
    }
    const comment = await site.addComment(c.get("token").account_id, issue, body.body);
    return c.json(site.json.apiComment(issue, comment), 201);
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
    if (!ids) {
      return c.json({ errorMessages: ["webhookIds are required."], errors: {} }, 400);
    }
    c.get("site").deleteWebhooks(c.get("token"), ids);
    return c.body(null, 202);
  });
  rest.put("/webhook/refresh", requireScope("manage:jira-webhook"), async (c) => {
    const ids = webhookIds(await c.req.json().catch(() => null));
    if (!ids) {
      return c.json({ errorMessages: ["webhookIds are required."], errors: {} }, 400);
    }
    return c.json({ expirationDate: c.get("site").refreshWebhooks(c.get("token"), ids) });
  });
  rest.notFound((c) => c.json({ errorMessages: ["Not found"], errors: {} }, 404));

  app.route(REST_PREFIX, rest);
  app.notFound((c) => c.json({ code: 404, message: "Not Found" }, 404));
  return app;
}

function webhookIds(body: unknown): number[] | null {
  const ids = (body as { webhookIds?: unknown } | null)?.webhookIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return null;
  }
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

  app.route("/", controlRoutes());
  app.notFound(() => errorPage("Page not found.", 404));
  return app;
}

function controlRoutes() {
  return routes<Env>()
    .openapi(jiraStateRoute, (c) => {
      const site = c.get("site");
      return c.json(
        {
          spec: site.state,
          issues: site.data.issues.map((issue) => site.json.apiIssue(issue)),
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
        },
        200,
      );
    })
    .openapi(createIssueRoute, async (c) => {
      const site = c.get("site");
      const body = c.req.valid("json");
      const actor = findUser(site.state, body.user);
      if (!actor) {
        return c.json(unknownUser(body.user), 400);
      }
      const { project } = body;
      if (!site.state.projects.some((candidate) => candidate.key === project)) {
        return c.json(apiError("project_not_found", `No project with key ${project}.`), 400);
      }
      const fields = issueFields(site, body);
      if ("error" in fields) {
        return c.json(fields, 400);
      }
      const issue = await site.createIssue(actor.account_id, {
        ...fields,
        project,
        summary: body.summary,
        status: body.status,
      });
      return c.json(site.json.apiIssue(issue), 201);
    })
    .openapi(updateIssueRoute, async (c) => {
      const site = c.get("site");
      const { key } = c.req.valid("param");
      const body = c.req.valid("json");
      const issue = site.issue(key);
      if (!issue) {
        return c.json(issueNotFound(key), 404);
      }
      const actor = findUser(site.state, body.user);
      if (!actor) {
        return c.json(unknownUser(body.user), 400);
      }
      const fields = issueFields(site, body);
      if ("error" in fields) {
        return c.json(fields, 400);
      }
      const changelog = await site.updateIssue(actor.account_id, issue, fields);
      return c.json({ issue: site.json.apiIssue(issue), changelog }, 200);
    })
    .openapi(deleteIssueRoute, async (c) => {
      const site = c.get("site");
      const { key } = c.req.valid("param");
      const { user } = c.req.valid("query");
      const issue = site.issue(key);
      if (!issue) {
        return c.json(issueNotFound(key), 404);
      }
      const actor = findUser(site.state, user);
      if (!actor) {
        return c.json(unknownUser(user), 400);
      }
      await site.deleteIssue(actor.account_id, issue);
      return c.body(null, 204);
    })
    .openapi(createCommentRoute, async (c) => {
      const site = c.get("site");
      const { key } = c.req.valid("param");
      const body = c.req.valid("json");
      const issue = site.issue(key);
      if (!issue) {
        return c.json(issueNotFound(key), 404);
      }
      const actor = findUser(site.state, body.user);
      if (!actor) {
        return c.json(unknownUser(body.user), 400);
      }
      const adf = textOrAdf(body.body);
      if (!adf) {
        return c.json(apiError("invalid_request", "body: can't be empty."), 400);
      }
      const comment = await site.addComment(actor.account_id, issue, adf);
      return c.json(site.json.apiComment(issue, comment), 201);
    });
}

function unknownUser(ref: string): ApiError {
  return apiError("user_not_found", `No user named ${ref} in this world.`);
}

function issueNotFound(key: string): ApiError {
  return apiError("issue_not_found", `No issue ${key} in this world.`);
}

function issueFields(
  site: JiraSite,
  body: {
    summary?: string;
    description?: string | Adf | null;
    labels?: string[];
    status?: IssueStatus;
    assignee?: string | null;
  },
): IssuePatch | ApiError {
  const fields: IssuePatch = {};
  if (body.summary !== undefined) {
    fields.summary = body.summary;
  }
  if (body.description !== undefined) {
    fields.description = textOrAdf(body.description) ?? null;
  }
  if (body.labels !== undefined) {
    fields.labels = body.labels;
  }
  if (body.status !== undefined) {
    fields.status = body.status;
  }
  if (body.assignee === null) {
    fields.assignee = null;
  } else if (body.assignee !== undefined) {
    const user = findUser(site.state, body.assignee);
    if (!user) {
      return apiError("user_not_found", `No user named ${body.assignee} to assign.`);
    }
    fields.assignee = user.account_id;
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
