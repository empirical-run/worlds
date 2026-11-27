import type { IssueStatus, JiraState, JiraUserState } from "./spec";

export type Adf = { type: "doc"; version: 1; content: unknown[] };

export type Comment = { id: string; author: string; body: Adf; created: number; updated: number };

export type Issue = {
  id: string;
  key: string;
  project: string;
  summary: string;
  description: Adf | null;
  labels: string[];
  status: IssueStatus;
  reporter: string;
  assignee: string | null;
  created: number;
  updated: number;
  comments: Comment[];
};

export type Grant = { client_id: string; account_id: string; scopes: string[] };

export type AuthCode = Grant & { code: string; redirect_uri: string; expires_at: number };

export type AccessToken = Grant & { token: string; expires_at: number };

export type RefreshToken = Grant & { token: string; rotated_at: number | null };

export type Webhook = {
  id: number;
  client_id: string;
  account_id: string;
  url: string;
  jql: string;
  events: string[];
  expires_at: number;
};

export type JiraData = {
  state: JiraState;
  issues: Issue[];
  sequence: { issue: number; comment: number; webhook: number; changelog: number };
  codes: AuthCode[];
  access_tokens: AccessToken[];
  refresh_tokens: RefreshToken[];
  webhooks: Webhook[];
};

export type Origins = { site: string; auth: string; api: string };

const STATUS_DETAILS: Record<
  IssueStatus,
  { id: string; category: { id: number; key: string; name: string; colorName: string } }
> = {
  "To Do": { id: "10000", category: { id: 2, key: "new", name: "To Do", colorName: "blue-gray" } },
  "In Progress": {
    id: "3",
    category: { id: 4, key: "indeterminate", name: "In Progress", colorName: "yellow" },
  },
  Done: { id: "10001", category: { id: 3, key: "done", name: "Done", colorName: "green" } },
};

export function statusId(status: IssueStatus): string {
  return STATUS_DETAILS[status].id;
}

export function jiraDate(ms: number): string {
  return new Date(ms).toISOString().replace("Z", "+0000");
}

export function textToAdf(text: string): Adf {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\n{2,}/).map((paragraph) => ({
      type: "paragraph",
      content: paragraph ? [{ type: "text", text: paragraph }] : [],
    })),
  };
}

export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const { type, text, content, attrs } = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: { href?: string };
  };
  if (type === "text") {
    const link = (
      (node as { marks?: { type?: string; attrs?: { href?: string } }[] }).marks ?? []
    ).find((mark) => mark.type === "link");
    return link?.attrs?.href ? `[${text ?? ""}|${link.attrs.href}]` : (text ?? "");
  }
  if (type === "hardBreak") return "\n";
  if (type === "inlineCard") return attrs?.href ?? "";
  return (content ?? []).map(adfToText).join(type === "doc" ? "\n\n" : "");
}

export function isAdf(value: unknown): value is Adf {
  const doc = value as Partial<Adf> | null;
  return Boolean(doc) && doc?.type === "doc" && doc?.version === 1 && Array.isArray(doc?.content);
}

export function findUser(state: JiraState, ref: string): JiraUserState | undefined {
  return state.users.find((user) => user.account_id === ref || user.name === ref);
}

export class JiraJson {
  constructor(
    private state: JiraState,
    private origins: Origins,
  ) {}

  private get restBase(): string {
    return `${this.origins.api}/ex/jira/${this.state.site.cloud_id}/rest/api/3`;
  }

  private siteBase(version: 2 | 3): string {
    return `${this.origins.site}/rest/api/${version}`;
  }

  user(accountId: string | null, via: "api" | "site", withEmail = true) {
    const user = accountId
      ? this.state.users.find((candidate) => candidate.account_id === accountId)
      : undefined;
    if (!user) return null;
    const avatar = `${this.origins.site}/avatar/${user.account_id}.png`;
    return {
      self: `${via === "api" ? this.restBase : this.siteBase(2)}/user?accountId=${user.account_id}`,
      accountId: user.account_id,
      accountType: "atlassian",
      ...(withEmail && !user.hide_email ? { emailAddress: user.email } : {}),
      avatarUrls: { "48x48": avatar, "24x24": avatar, "16x16": avatar, "32x32": avatar },
      displayName: user.display_name,
      active: true,
      timeZone: "Etc/UTC",
      locale: "en_US",
    };
  }

  private project(key: string, base: string) {
    const project = this.state.projects.find((candidate) => candidate.key === key);
    return {
      self: `${base}/project/${project?.id ?? ""}`,
      id: project?.id ?? "",
      key,
      name: project?.name ?? key,
      projectTypeKey: "software",
      simplified: true,
    };
  }

  private status(status: IssueStatus, base: string) {
    const details = STATUS_DETAILS[status];
    return {
      self: `${base}/status/${details.id}`,
      description: "",
      name: status,
      id: details.id,
      statusCategory: {
        self: `${base}/statuscategory/${details.category.id}`,
        ...details.category,
      },
    };
  }

  comment(issue: Issue, comment: Comment, via: "api" | "site") {
    const base = via === "api" ? this.restBase : this.siteBase(2);
    const author = this.user(comment.author, via, via === "api");
    return {
      self: `${base}/issue/${issue.id}/comment/${comment.id}`,
      id: comment.id,
      author,
      body: via === "api" ? comment.body : adfToText(comment.body),
      updateAuthor: author,
      created: jiraDate(comment.created),
      updated: jiraDate(comment.updated),
      jsdPublic: true,
    };
  }

  issue(issue: Issue, via: "api" | "site") {
    const base = via === "api" ? this.restBase : this.siteBase(2);
    const withEmail = via === "api";
    const comments = issue.comments.map((comment) => this.comment(issue, comment, via));
    return {
      expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
      id: issue.id,
      self: `${base}/issue/${issue.id}`,
      key: issue.key,
      fields: {
        summary: issue.summary,
        description:
          via === "api"
            ? issue.description
            : issue.description
              ? adfToText(issue.description)
              : null,
        labels: issue.labels,
        status: this.status(issue.status, base),
        issuetype: {
          self: `${base}/issuetype/10001`,
          id: "10001",
          name: "Task",
          subtask: false,
          hierarchyLevel: 0,
        },
        priority: { self: `${base}/priority/3`, id: "3", name: "Medium" },
        project: this.project(issue.project, base),
        reporter: this.user(issue.reporter, via, withEmail),
        creator: this.user(issue.reporter, via, withEmail),
        assignee: this.user(issue.assignee, via, withEmail),
        created: jiraDate(issue.created),
        updated: jiraDate(issue.updated),
        statuscategorychangedate: jiraDate(issue.created),
        attachment: [],
        comment: {
          comments,
          self: `${base}/issue/${issue.id}/comment`,
          maxResults: comments.length,
          total: comments.length,
          startAt: 0,
        },
      },
    };
  }
}
