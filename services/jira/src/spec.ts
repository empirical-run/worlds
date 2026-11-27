import type { z } from "@hono/zod-openapi";

import type { JiraSpecSchema, JiraStateSchema } from "./contract";

export const JIRA_SCOPES = [
  "read:jira-work",
  "write:jira-work",
  "read:jira-user",
  "manage:jira-webhook",
  "manage:jira-project",
  "manage:jira-configuration",
  "read:me",
] as const;

export const OFFLINE_ACCESS = "offline_access";

export const ISSUE_STATUSES = ["To Do", "In Progress", "Done"] as const;

export type JiraScope = (typeof JIRA_SCOPES)[number];

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export type JiraSpec = z.output<typeof JiraSpecSchema>;

export type JiraState = z.output<typeof JiraStateSchema>;

export type JiraIssueSpec = NonNullable<JiraSpec["issues"]>[number];

export type JiraUserState = JiraState["users"][number];

export type JiraAppState = JiraState["apps"][number];

export const DEFAULT_JIRA_SPEC: JiraSpec = {
  site: { name: "worlds" },
  users: [{ name: "alice", display_name: "Alice Tester" }],
  projects: [{ key: "WRLD", name: "Worlds" }],
};

export function jiraSpecProblems(spec: JiraSpec): string[] {
  const problems: string[] = [];
  const users = spec.users ?? [];
  const userRefs = new Set(
    users.flatMap((user) => [user.name, ...(user.account_id ? [user.account_id] : [])]),
  );
  const projectKeys = new Set((spec.projects ?? []).map((project) => project.key));
  const duplicate = (values: string[]) =>
    values.find((value, index) => values.indexOf(value) !== index);
  const duplicateUser = duplicate(users.map((user) => user.name));
  if (duplicateUser) problems.push(`users: duplicate name ${duplicateUser}`);
  const duplicateProject = duplicate((spec.projects ?? []).map((project) => project.key));
  if (duplicateProject) problems.push(`projects: duplicate key ${duplicateProject}`);
  const duplicateClient = duplicate(
    (spec.apps ?? []).flatMap((app) =>
      app.credentials?.client_id ? [app.credentials.client_id] : [],
    ),
  );
  if (duplicateClient) problems.push(`apps: duplicate client_id ${duplicateClient}`);
  for (const [index, issue] of (spec.issues ?? []).entries()) {
    if (!projectKeys.has(issue.project))
      problems.push(`issues[${index}].project: unknown project ${issue.project}`);
    for (const [field, ref] of [
      ["reporter", issue.reporter],
      ["assignee", issue.assignee],
    ] as const) {
      if (ref && !userRefs.has(ref))
        problems.push(`issues[${index}].${field}: unknown user ${ref}`);
    }
    for (const comment of issue.comments ?? []) {
      if (!userRefs.has(comment.author))
        problems.push(`issues[${index}].comments: unknown user ${comment.author}`);
    }
  }
  if ((spec.issues ?? []).length > 0 && users.length === 0)
    problems.push("issues: the world has no user to report them");
  return problems;
}
