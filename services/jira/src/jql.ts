import type { Issue } from "./model";

type Field = "labels" | "project" | "status" | "issuekey" | "assignee" | "reporter";

type Clause = { field: Field; negated: boolean; values: string[] };

export type Jql = Clause[];

const FIELDS: Record<string, Field> = {
  labels: "labels",
  project: "project",
  status: "status",
  issuekey: "issuekey",
  key: "issuekey",
  assignee: "assignee",
  reporter: "reporter",
};

const VALUE = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,()"']+`;
const CLAUSE = new RegExp(String.raw`^\s*([a-zA-Z]+)\s*(=|!=|not\s+in|in)\s*(\((?:\s*(?:${VALUE})\s*,?)+\)|${VALUE})\s*`, "i");

export function parseJql(jql: string): Jql | null {
  const clauses: Clause[] = [];
  let rest = jql.trim();
  if (!rest) return [];
  while (rest) {
    const match = CLAUSE.exec(rest);
    const field = match?.[1] ? FIELDS[match[1].toLowerCase()] : undefined;
    if (!match || !field) return null;
    const operator = (match[2] ?? "").toLowerCase().replace(/\s+/g, " ");
    const raw = match[3] ?? "";
    const values = raw.startsWith("(") ? [...raw.slice(1, -1).matchAll(new RegExp(VALUE, "g"))].map((value) => unquote(value[0])) : [unquote(raw)];
    if ((operator === "=" || operator === "!=") && raw.startsWith("(")) return null;
    clauses.push({ field, negated: operator === "!=" || operator === "not in", values });
    rest = rest.slice(match[0].length);
    if (!rest) break;
    const conjunction = /^and\s+/i.exec(rest);
    if (!conjunction) return null;
    rest = rest.slice(conjunction[0].length);
  }
  return clauses;
}

export function matchesJql(jql: Jql, issue: Issue, userName: (accountId: string | null) => string[]): boolean {
  return jql.every((clause) => {
    const actual = fieldValues(clause.field, issue, userName).map((value) => value.toLowerCase());
    const hit = clause.values.some((value) => actual.includes(value.toLowerCase()));
    return clause.negated ? !hit : hit;
  });
}

function fieldValues(field: Field, issue: Issue, userName: (accountId: string | null) => string[]): string[] {
  switch (field) {
    case "labels":
      return issue.labels;
    case "project":
      return [issue.project];
    case "status":
      return [issue.status];
    case "issuekey":
      return [issue.key, issue.id];
    case "assignee":
      return userName(issue.assignee);
    case "reporter":
      return userName(issue.reporter);
  }
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return value;
}
