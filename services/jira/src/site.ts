import type { DeliveryTarget, JiraDelivery } from "./delivery";
import { matchesJql, parseJql } from "./jql";
import {
  adfToText,
  findUser,
  JiraJson,
  statusId,
  textToAdf,
  type AccessToken,
  type Adf,
  type AuthCode,
  type Comment,
  type Grant,
  type Issue,
  type JiraData,
  type Origins,
  type RefreshToken,
  type Webhook,
} from "./model";
import { OFFLINE_ACCESS, type IssueStatus, type JiraAppState } from "./spec";

const CODE_LIFETIME_MS = 10 * 60_000;
const ACCESS_LIFETIME_S = 3600;
const REFRESH_REUSE_MS = 10 * 60_000;
const WEBHOOK_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const WEBHOOKS_PER_USER = 5;
const SUPPORTED_EVENTS = new Set([
  "jira:issue_created",
  "jira:issue_updated",
  "jira:issue_deleted",
  "comment_created",
  "comment_updated",
  "comment_deleted",
]);

export type IssueInput = {
  project: string;
  summary: string;
  description?: Adf | null;
  labels?: string[];
  status: IssueStatus;
  assignee?: string | null;
};

export type IssuePatch = Partial<Omit<IssueInput, "project">>;

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
  scope: string;
  refresh_token?: string;
};

export type WebhookRegistration = { createdWebhookId: number } | { errors: string[] };

type ChangeItem = {
  field: string;
  fieldtype: "jira";
  fieldId: string;
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
};

export class JiraSite {
  readonly json: JiraJson;

  constructor(
    readonly data: JiraData,
    readonly origins: Origins,
    private readonly delivery: JiraDelivery,
  ) {
    this.json = new JiraJson(data.state, origins);
  }

  get state() {
    return this.data.state;
  }

  app(clientId: string | null | undefined): JiraAppState | undefined {
    return clientId
      ? this.state.apps.find((app) => app.credentials.client_id === clientId)
      : undefined;
  }

  issue(idOrKey: string): Issue | undefined {
    const wanted = idOrKey.toUpperCase();
    return this.data.issues.find((issue) => issue.id === idOrKey || issue.key === wanted);
  }

  issueCode(grant: Grant, redirectUri: string): string {
    const code = randomToken(32);
    this.prune();
    this.data.codes.push({
      ...grant,
      code,
      redirect_uri: redirectUri,
      expires_at: Date.now() + CODE_LIFETIME_MS,
    });
    return code;
  }

  exchangeCode(app: JiraAppState, code: string, redirectUri: string): TokenResponse | null {
    const index = this.data.codes.findIndex((entry) => entry.code === code);
    const entry: AuthCode | undefined = this.data.codes[index];
    if (!entry) {
      return null;
    }
    this.data.codes.splice(index, 1);
    if (
      entry.expires_at < Date.now() ||
      entry.client_id !== app.credentials.client_id ||
      entry.redirect_uri !== redirectUri
    ) {
      return null;
    }
    return this.mintTokens(entry);
  }

  refresh(app: JiraAppState, token: string): TokenResponse | null {
    const entry = this.data.refresh_tokens.find(
      (candidate) => candidate.token === token && candidate.client_id === app.credentials.client_id,
    );
    if (!entry) {
      return null;
    }
    if (entry.rotated_at !== null && Date.now() - entry.rotated_at > REFRESH_REUSE_MS) {
      return null;
    }
    entry.rotated_at ??= Date.now();
    return this.mintTokens(entry);
  }

  authenticate(authorization: string | null): AccessToken | null {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const entry = token
      ? this.data.access_tokens.find((candidate) => candidate.token === token)
      : undefined;
    if (!entry || entry.expires_at < Date.now() || !this.app(entry.client_id)) {
      return null;
    }
    return entry;
  }

  private mintTokens(grant: Grant): TokenResponse {
    this.prune();
    const access: AccessToken = {
      client_id: grant.client_id,
      account_id: grant.account_id,
      scopes: grant.scopes,
      token: randomToken(48),
      expires_at: Date.now() + ACCESS_LIFETIME_S * 1000,
    };
    this.data.access_tokens.push(access);
    const response: TokenResponse = {
      access_token: access.token,
      expires_in: ACCESS_LIFETIME_S,
      token_type: "Bearer",
      scope: grant.scopes.join(" "),
    };
    if (grant.scopes.includes(OFFLINE_ACCESS)) {
      const refresh: RefreshToken = {
        client_id: grant.client_id,
        account_id: grant.account_id,
        scopes: grant.scopes,
        token: randomToken(48),
        rotated_at: null,
      };
      this.data.refresh_tokens.push(refresh);
      response.refresh_token = refresh.token;
    }
    return response;
  }

  private prune(): void {
    const now = Date.now();
    this.data.codes = this.data.codes.filter((entry) => entry.expires_at > now);
    this.data.access_tokens = this.data.access_tokens.filter((entry) => entry.expires_at > now);
    this.data.refresh_tokens = this.data.refresh_tokens.filter(
      (entry) => entry.rotated_at === null || now - entry.rotated_at <= REFRESH_REUSE_MS,
    );
  }

  webhooksFor(token: AccessToken): Webhook[] {
    return this.data.webhooks.filter(
      (webhook) => webhook.client_id === token.client_id && webhook.account_id === token.account_id,
    );
  }

  registerWebhooks(
    token: AccessToken,
    url: string,
    specs: { jqlFilter?: unknown; events?: unknown }[],
  ): WebhookRegistration[] {
    const existing = this.webhooksFor(token);
    const otherUrl = existing.find((webhook) => webhook.url !== url);
    let count = existing.length;
    return specs.map((spec) => {
      if (otherUrl) {
        return {
          errors: [
            `Only a single URL per user is allowed to be registered via REST API. The currently used URL: ${otherUrl.url}.`,
          ],
        };
      }
      const jql = typeof spec.jqlFilter === "string" ? spec.jqlFilter : "";
      if (!jql || !parseJql(jql)) {
        return { errors: [`The JQL query is invalid or not supported for webhooks: ${jql}`] };
      }
      const events = Array.isArray(spec.events)
        ? spec.events.filter((event): event is string => typeof event === "string")
        : [];
      const unsupported = events.find((event) => !SUPPORTED_EVENTS.has(event));
      if (events.length === 0 || unsupported) {
        return { errors: [`Webhook events are invalid: ${unsupported ?? "none given"}`] };
      }
      if (count >= WEBHOOKS_PER_USER) {
        return {
          errors: [`The number of webhooks per user exceeds the limit of ${WEBHOOKS_PER_USER}.`],
        };
      }
      count += 1;
      const webhook: Webhook = {
        id: ++this.data.sequence.webhook,
        client_id: token.client_id,
        account_id: token.account_id,
        url,
        jql,
        events,
        expires_at: Date.now() + WEBHOOK_LIFETIME_MS,
      };
      this.data.webhooks.push(webhook);
      return { createdWebhookId: webhook.id };
    });
  }

  deleteWebhooks(token: AccessToken, ids: number[]): void {
    this.data.webhooks = this.data.webhooks.filter(
      (webhook) =>
        !(
          ids.includes(webhook.id) &&
          webhook.client_id === token.client_id &&
          webhook.account_id === token.account_id
        ),
    );
  }

  refreshWebhooks(token: AccessToken, ids: number[]): number {
    const expiresAt = Date.now() + WEBHOOK_LIFETIME_MS;
    for (const webhook of this.webhooksFor(token)) {
      if (ids.includes(webhook.id)) {
        webhook.expires_at = expiresAt;
      }
    }
    return expiresAt;
  }

  seedIssue(reporter: string, input: IssueInput, created = Date.now()): Issue {
    const project = this.state.projects.find((candidate) => candidate.key === input.project);
    if (!project) {
      throw new Error(`unknown project ${input.project}`);
    }
    const number =
      this.data.issues
        .filter((issue) => issue.project === project.key)
        .reduce((max, issue) => Math.max(max, Number(issue.key.split("-")[1])), 0) + 1;
    const issue: Issue = {
      id: String(10000 + this.data.sequence.issue++),
      key: `${project.key}-${number}`,
      project: project.key,
      summary: input.summary,
      description: input.description ?? null,
      labels: input.labels ?? [],
      status: input.status,
      reporter,
      assignee: input.assignee ?? null,
      created,
      updated: created,
      comments: [],
    };
    this.data.issues.push(issue);
    return issue;
  }

  seedComment(issue: Issue, author: string, body: Adf): Comment {
    const now = Date.now();
    const comment: Comment = {
      id: String(10000 + this.data.sequence.comment++),
      author,
      body,
      created: now,
      updated: now,
    };
    issue.comments.push(comment);
    issue.updated = now;
    return comment;
  }

  async createIssue(actor: string, input: IssueInput): Promise<Issue> {
    const issue = this.seedIssue(actor, input);
    await this.emit("jira:issue_created", actor, issue, { issue_event_type_name: "issue_created" });
    return issue;
  }

  async updateIssue(actor: string, issue: Issue, patch: IssuePatch): Promise<ChangeItem[]> {
    const items: ChangeItem[] = [];
    const change = (
      field: string,
      from: string | null,
      fromString: string | null,
      to: string | null,
      toString: string | null,
    ) => items.push({ field, fieldtype: "jira", fieldId: field, from, fromString, to, toString });
    if (patch.summary !== undefined && patch.summary !== issue.summary) {
      change("summary", null, issue.summary, null, patch.summary);
      issue.summary = patch.summary;
    }
    if (patch.description !== undefined) {
      const before = issue.description ? adfToText(issue.description) : null;
      const after = patch.description ? adfToText(patch.description) : null;
      if (before !== after) {
        change("description", null, before, null, after);
      }
      issue.description = patch.description;
    }
    if (patch.labels !== undefined) {
      const labels = [...new Set(patch.labels)].sort();
      if (labels.join(" ") !== [...issue.labels].sort().join(" ")) {
        change("labels", null, [...issue.labels].sort().join(" "), null, labels.join(" "));
      }
      issue.labels = labels;
    }
    if (patch.status !== undefined && patch.status !== issue.status) {
      change("status", statusId(issue.status), issue.status, statusId(patch.status), patch.status);
      issue.status = patch.status;
    }
    if (patch.assignee !== undefined && patch.assignee !== issue.assignee) {
      const name = (accountId: string | null) =>
        accountId ? (findUser(this.state, accountId)?.display_name ?? null) : null;
      change(
        "assignee",
        issue.assignee,
        name(issue.assignee),
        patch.assignee,
        name(patch.assignee),
      );
      issue.assignee = patch.assignee;
    }
    if (items.length === 0) {
      return items;
    }
    issue.updated = Date.now();
    const fields = new Set(items.map((item) => item.field));
    const type =
      fields.size === 1 && fields.has("assignee")
        ? "issue_assigned"
        : fields.size === 1 && fields.has("status")
          ? "issue_generic"
          : "issue_updated";
    await this.emit("jira:issue_updated", actor, issue, {
      issue_event_type_name: type,
      changelog: { id: String(10000 + this.data.sequence.changelog++), items },
    });
    return items;
  }

  async deleteIssue(actor: string, issue: Issue): Promise<void> {
    this.data.issues = this.data.issues.filter((candidate) => candidate.id !== issue.id);
    await this.emit("jira:issue_deleted", actor, issue, { issue_event_type_name: "issue_deleted" });
  }

  async addComment(actor: string, issue: Issue, body: Adf): Promise<Comment> {
    const comment = this.seedComment(issue, actor, body);
    await this.emit(
      "comment_created",
      actor,
      issue,
      { comment: this.json.siteComment(issue, comment) },
      true,
    );
    return comment;
  }

  private async emit(
    event: string,
    actor: string,
    issue: Issue,
    extra: Record<string, unknown>,
    commentEvent = false,
  ): Promise<void> {
    const now = Date.now();
    const userNames = (accountId: string | null) => {
      const user = accountId ? findUser(this.state, accountId) : undefined;
      return user ? [user.account_id, user.name, user.display_name] : [];
    };
    const groups = new Map<string, { target: DeliveryTarget; ids: number[] }>();
    for (const webhook of this.data.webhooks) {
      if (
        webhook.expires_at < now ||
        !webhook.events.includes(event) ||
        !this.app(webhook.client_id)
      ) {
        continue;
      }
      const jql = parseJql(webhook.jql);
      if (!jql || !matchesJql(jql, issue, userNames)) {
        continue;
      }
      const groupKey = `${webhook.client_id} ${webhook.account_id} ${webhook.url}`;
      const group = groups.get(groupKey) ?? {
        target: {
          url: webhook.url,
          clientId: webhook.client_id,
          accountId: webhook.account_id,
          cloudId: this.state.site.cloud_id,
        },
        ids: [],
      };
      group.ids.push(webhook.id);
      groups.set(groupKey, group);
    }
    if (groups.size === 0) {
      return;
    }
    const issueJson = this.json.siteIssue(issue);
    const { comment: _comment, ...issueFields } = issueJson.fields;
    const payload = {
      timestamp: now,
      webhookEvent: event,
      user: this.json.user(actor, "site", false),
      issue: commentEvent ? { ...issueJson, fields: issueFields } : issueJson,
      ...extra,
    };
    for (const { target, ids } of groups.values()) {
      await this.delivery.enqueue(target, event, { ...payload, matchedWebhookIds: ids });
    }
  }
}

export function textOrAdf(value: unknown): Adf | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return textToAdf(value);
  }
  return value as Adf;
}

export function randomToken(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
