import type { z } from "@hono/zod-openapi";

import type { LinearSpecSchema, LinearStateSchema } from "./contract";

export const LINEAR_SCOPES = [
  "read",
  "write",
  "issues:create",
  "comments:create",
  "admin",
  "app:assignable",
  "app:mentionable",
] as const;

export const APP_ONLY_SCOPES: readonly string[] = ["app:assignable", "app:mentionable"];

export const ISSUE_STATES = ["Backlog", "Todo", "In Progress", "Done", "Canceled"] as const;

export type LinearScope = (typeof LINEAR_SCOPES)[number];

export type IssueState = (typeof ISSUE_STATES)[number];

export type LinearSpec = z.output<typeof LinearSpecSchema>;

export type LinearState = z.output<typeof LinearStateSchema>;

export type LinearUserState = LinearState["users"][number];

export type LinearAppState = LinearState["apps"][number];

export function linearSpecProblems(spec: LinearSpec): string[] {
  const problems: string[] = [];
  const users = spec.users ?? [];
  const userRefs = new Set(users.flatMap((user) => [user.name, ...(user.id ? [user.id] : [])]));
  const teamKeys = new Set((spec.teams ?? []).map((team) => team.key));
  const duplicate = (values: string[]) =>
    values.find((value, index) => values.indexOf(value) !== index);
  const duplicateUser = duplicate(users.map((user) => user.name));
  if (duplicateUser) {
    problems.push(`users: duplicate name ${duplicateUser}`);
  }
  const duplicateTeam = duplicate((spec.teams ?? []).map((team) => team.key));
  if (duplicateTeam) {
    problems.push(`teams: duplicate key ${duplicateTeam}`);
  }
  const duplicateClient = duplicate(
    (spec.apps ?? []).flatMap((app) =>
      app.credentials?.client_id ? [app.credentials.client_id] : [],
    ),
  );
  if (duplicateClient) {
    problems.push(`apps: duplicate client_id ${duplicateClient}`);
  }
  for (const [index, issue] of (spec.issues ?? []).entries()) {
    if (!teamKeys.has(issue.team)) {
      problems.push(`issues[${index}].team: unknown team ${issue.team}`);
    }
    for (const [field, ref] of [
      ["creator", issue.creator],
      ["assignee", issue.assignee],
    ] as const) {
      if (ref && !userRefs.has(ref)) {
        problems.push(`issues[${index}].${field}: unknown user ${ref}`);
      }
    }
    for (const comment of issue.comments ?? []) {
      if (!userRefs.has(comment.author)) {
        problems.push(`issues[${index}].comments: unknown user ${comment.author}`);
      }
    }
  }
  return problems;
}
