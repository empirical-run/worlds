export const JIRA_SCOPES = ["read:jira-work", "write:jira-work", "read:jira-user", "manage:jira-webhook", "manage:jira-project", "manage:jira-configuration", "read:me"] as const;

export const OFFLINE_ACCESS = "offline_access";

export const ISSUE_STATUSES = ["To Do", "In Progress", "Done"] as const;

export type JiraScope = (typeof JIRA_SCOPES)[number];

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export type JiraUserSpec = {
  account_id?: string;
  name: string;
  display_name?: string;
  email?: string;
  hide_email?: boolean;
};

export type JiraProjectSpec = { id?: string; key: string; name?: string };

export type JiraCommentSpec = { author: string; body: string };

export type JiraIssueSpec = {
  project: string;
  summary: string;
  description?: string;
  labels?: string[];
  status?: IssueStatus;
  reporter?: string;
  assignee?: string;
  comments?: JiraCommentSpec[];
};

export type JiraCredentials = { client_id: string; client_secret: string };

export type JiraAppSpec = {
  name: string;
  callback_urls: string[];
  scopes?: JiraScope[];
  credentials?: Partial<JiraCredentials>;
};

export type JiraSpec = {
  site?: { cloud_id?: string; name?: string };
  users?: JiraUserSpec[];
  projects?: JiraProjectSpec[];
  issues?: JiraIssueSpec[];
  apps?: JiraAppSpec[];
};

export type JiraUserState = Required<Pick<JiraUserSpec, "account_id" | "name" | "display_name" | "email" | "hide_email">>;

export type JiraAppState = { name: string; callback_urls: string[]; scopes: JiraScope[]; credentials: JiraCredentials };

export type JiraState = {
  site: { cloud_id: string; name: string; url: string };
  users: JiraUserState[];
  projects: Required<JiraProjectSpec>[];
  issues: (JiraIssueSpec & { key: string })[];
  apps: JiraAppState[];
};

export const DEFAULT_JIRA_SPEC: JiraSpec = {
  site: { name: "worlds" },
  users: [{ name: "alice", display_name: "Alice Tester" }],
  projects: [{ key: "WRLD", name: "Worlds" }],
};

export function jiraSpecProblems(spec: JiraSpec): string[] {
  const problems: string[] = [];
  const users = spec.users ?? [];
  const userRefs = new Set(users.flatMap((user) => [user.name, ...(user.account_id ? [user.account_id] : [])]));
  const projectKeys = new Set((spec.projects ?? []).map((project) => project.key));
  const duplicate = (values: string[]) => values.find((value, index) => values.indexOf(value) !== index);
  const duplicateUser = duplicate(users.map((user) => user.name));
  if (duplicateUser) problems.push(`users: duplicate name ${duplicateUser}`);
  const duplicateProject = duplicate((spec.projects ?? []).map((project) => project.key));
  if (duplicateProject) problems.push(`projects: duplicate key ${duplicateProject}`);
  const duplicateClient = duplicate((spec.apps ?? []).flatMap((app) => (app.credentials?.client_id ? [app.credentials.client_id] : [])));
  if (duplicateClient) problems.push(`apps: duplicate client_id ${duplicateClient}`);
  for (const [index, issue] of (spec.issues ?? []).entries()) {
    if (!projectKeys.has(issue.project)) problems.push(`issues[${index}].project: unknown project ${issue.project}`);
    for (const [field, ref] of [["reporter", issue.reporter], ["assignee", issue.assignee]] as const) {
      if (ref && !userRefs.has(ref)) problems.push(`issues[${index}].${field}: unknown user ${ref}`);
    }
    for (const comment of issue.comments ?? []) {
      if (!userRefs.has(comment.author)) problems.push(`issues[${index}].comments: unknown user ${comment.author}`);
    }
  }
  if ((spec.issues ?? []).length > 0 && users.length === 0) problems.push("issues: the world has no user to report them");
  return problems;
}
