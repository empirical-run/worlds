import { createRoute, z } from "@hono/zod-openapi";
import {
  defineService,
  errorResponse,
  jsonResponse,
  security,
  userRef,
  worldServer,
} from "@worlds/contract";

import { ISSUE_STATUSES, JIRA_SCOPES, jiraSpecProblems } from "./spec";

const JiraUserSpecSchema = z
  .object({
    account_id: z
      .string()
      .regex(/^[0-9A-Za-z:-]{6,128}$/)
      .optional()
      .openapi({ example: "712020:4f1c6b9e-3d2a-4e8f-9b7c-1a2b3c4d5e6f" }),
    name: z
      .string()
      .regex(/^[a-z0-9._-]{1,80}$/, {
        error: "user names are lowercase letters, digits, . _ and -",
      })
      .openapi({ example: "alice" }),
    display_name: z.string().max(200).optional().openapi({ example: "Alice Tester" }),
    email: z.email().optional(),
    hide_email: z.boolean().optional().openapi({
      description:
        "Hide the email from apps, like a profile with email visibility off. GET /user then has no emailAddress.",
    }),
  })
  .openapi("JiraUserSpec");

const JiraProjectSpecSchema = z
  .object({
    id: z
      .string()
      .regex(/^[0-9]{1,18}$/)
      .optional(),
    key: z
      .string()
      .regex(/^[A-Z][A-Z0-9]{1,9}$/, {
        error: "project keys are 2-10 uppercase letters and digits, starting with a letter",
      })
      .openapi({ example: "WRLD" }),
    name: z.string().max(80).optional().openapi({ example: "Worlds" }),
  })
  .openapi("JiraProjectSpec");

const summary = z
  .string()
  .trim()
  .min(1, { error: "summary can't be empty." })
  .max(255)
  .openapi({ example: "Checkout fails for guest users" });

const labels = z
  .array(z.string().regex(/^\S{1,255}$/, { error: "labels can't contain spaces" }))
  .max(50);

const status = z.enum(ISSUE_STATUSES);

const JiraIssueSpecSchema = z
  .object({
    project: z.string().openapi({ example: "WRLD" }),
    summary,
    description: z.string().max(32_000).optional(),
    labels: labels.optional(),
    status: status.optional(),
    reporter: userRef.optional(),
    assignee: userRef.optional(),
    comments: z
      .array(z.object({ author: userRef, body: z.string().min(1).max(32_000) }))
      .max(100)
      .optional(),
  })
  .openapi("JiraIssueSpec");

const JiraCredentialsSchema = z
  .object({ client_id: z.string().min(8).max(128), client_secret: z.string().min(16).max(256) })
  .openapi("JiraCredentials");

const JiraAppSpecSchema = z
  .object({
    name: z.string().min(1).max(80).openapi({ example: "My app" }),
    callback_urls: z
      .array(z.string().regex(/^https?:\/\/[^\s]+$/))
      .min(1)
      .max(20)
      .openapi({
        description:
          "OAuth 2.0 (3LO) callback URLs. redirect_uri must equal one of them; a * in the host matches one label.",
        example: ["https://example.com/jira/callback"],
      }),
    scopes: z.array(z.enum(JIRA_SCOPES)).min(1).optional().openapi({
      description:
        "Scopes the app may request (offline_access is always allowed). Defaults to read:jira-work write:jira-work read:jira-user manage:jira-webhook.",
    }),
    credentials: JiraCredentialsSchema.partial().optional().openapi({
      description: "Pin the client id and secret, e.g. to match ones your app already has.",
    }),
  })
  .openapi("JiraAppSpec");

export const JiraSpecSchema = z
  .object({
    site: z
      .object({
        cloud_id: z.uuid().optional(),
        name: z
          .string()
          .regex(/^[a-z0-9-]{1,40}$/)
          .optional(),
      })
      .optional(),
    users: z.array(JiraUserSpecSchema).max(200).optional(),
    projects: z.array(JiraProjectSpecSchema).max(50).optional(),
    issues: z.array(JiraIssueSpecSchema).max(500).optional().openapi({
      description: "Created in order before any app is installed, so they send no webhooks.",
    }),
    apps: z.array(JiraAppSpecSchema).max(10).optional(),
  })
  .openapi("JiraSpec", {
    description:
      "Everything in the world's Jira site. Omitted ids and credentials are generated. Without a spec the site has one user (alice) and project WRLD.",
  });

export const JiraStateSchema = z
  .object({
    site: z.object({ cloud_id: z.string(), name: z.string(), url: z.string() }),
    users: z.array(
      z.object({
        account_id: z.string(),
        name: z.string(),
        display_name: z.string(),
        email: z.string(),
        hide_email: z.boolean(),
      }),
    ),
    projects: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })),
    issues: z.array(JiraIssueSpecSchema.extend({ key: z.string() })),
    apps: z.array(
      z.object({
        name: z.string(),
        callback_urls: z.array(z.string()),
        scopes: z.array(z.enum(JIRA_SCOPES)),
        credentials: JiraCredentialsSchema,
      }),
    ),
  })
  .openapi("JiraState", {
    description: "The world's Jira spec with every generated id and credential filled in.",
  });

const JiraUrlsSchema = z.object({
  site_url: z.url().openapi({
    description:
      "The Jira site, in place of https://your-site.atlassian.net. Issue pages are at /browse/{key}.",
    example: "https://k2v9x0q1m4-jira.makeworlds.dev",
  }),
  auth_url: z.url().openapi({
    description: "In place of https://auth.atlassian.com: /authorize and /oauth/token.",
    example: "https://k2v9x0q1m4-jira-auth.makeworlds.dev",
  }),
  api_url: z.url().openapi({
    description:
      "In place of https://api.atlassian.com: /oauth/token/accessible-resources and /ex/jira/{cloudId}/rest/api/3.",
    example: "https://k2v9x0q1m4-jira-api.makeworlds.dev",
  }),
});

const JiraAdfSchema = z
  .looseObject({ type: z.literal("doc"), version: z.literal(1), content: z.array(z.unknown()) })
  .openapi("JiraAdf", { description: "An Atlassian Document Format document." });

const text = z
  .union([z.string().max(32_000), JiraAdfSchema])
  .openapi({ description: "Plain text, or an Atlassian Document Format document." });

const actor = userRef.openapi({
  description: "The user who acts: their name or account id. Webhooks name them as the actor.",
});

const JiraUserJsonSchema = z.looseObject({
  accountId: z.string(),
  displayName: z.string(),
  emailAddress: z.string().optional(),
});

const JiraIssueSchema = z
  .looseObject({
    id: z.string(),
    key: z.string().openapi({ example: "WRLD-1" }),
    self: z.url(),
    fields: z.looseObject({
      summary: z.string(),
      description: JiraAdfSchema.nullable(),
      labels: z.array(z.string()),
      status: z.looseObject({ name: z.enum(ISSUE_STATUSES) }),
      reporter: JiraUserJsonSchema.nullable(),
      assignee: JiraUserJsonSchema.nullable(),
      created: z.string(),
      updated: z.string(),
    }),
  })
  .openapi("JiraIssue", { description: "The issue as the Jira REST API returns it." });

const JiraCommentSchema = z
  .looseObject({
    id: z.string(),
    self: z.url(),
    author: JiraUserJsonSchema.nullable(),
    body: JiraAdfSchema,
    created: z.string(),
    updated: z.string(),
  })
  .openapi("JiraComment", { description: "The comment as the Jira REST API returns it." });

const JiraChangeItemSchema = z
  .object({
    field: z.string(),
    fieldtype: z.literal("jira"),
    fieldId: z.string(),
    from: z.string().nullable(),
    fromString: z.string().nullable(),
    to: z.string().nullable(),
    toString: z.string().nullable(),
  })
  .openapi("JiraChangeItem");

const JiraIssueCreateSchema = z
  .object({
    user: actor,
    project: z
      .string()
      .optional()
      .openapi({ description: "A project key. Defaults to the first project." }),
    summary,
    description: text.optional(),
    labels: labels.optional(),
    status: status.optional(),
    assignee: userRef.optional(),
  })
  .openapi("JiraIssueCreate");

const JiraIssueUpdateSchema = z
  .object({
    user: actor,
    summary: summary.optional(),
    description: text.nullable().optional(),
    labels: labels.optional(),
    status: status.optional(),
    assignee: userRef.nullable().optional().openapi({ description: "null unassigns the issue." }),
  })
  .openapi("JiraIssueUpdate");

const JiraIssueUpdatedSchema = z
  .object({ issue: JiraIssueSchema, changelog: z.array(JiraChangeItemSchema) })
  .openapi("JiraIssueUpdated");

const JiraCommentCreateSchema = z.object({ user: actor, body: text }).openapi("JiraCommentCreate");

const JiraWorldStateSchema = z
  .object({
    spec: JiraStateSchema,
    issues: z.array(JiraIssueSchema),
    webhooks: z.array(
      z.object({
        id: z.number().int(),
        client_id: z.string(),
        account_id: z.string(),
        url: z.string(),
        jql: z.string(),
        events: z.array(z.string()),
        expires_at: z.number().openapi({ description: "Milliseconds since the epoch." }),
      }),
    ),
  })
  .openapi("JiraWorldState");

const IssueKeyParamsSchema = z.object({
  key: z.string().openapi({ param: { name: "key", in: "path" }, example: "WRLD-1" }),
});

const servers = [worldServer("jira")];
const tags = ["Jira world"];
const unauthorized = errorResponse("Missing or invalid credentials, or not your team's world");
const issueNotFound = errorResponse("No issue with that key or id");

export const jiraStateRoute = createRoute({
  method: "get",
  path: "/_worlds/jira/state",
  tags,
  servers,
  security,
  summary: "Get the Jira site's state",
  description: "The spec with generated ids filled in, every issue and the registered webhooks.",
  responses: {
    200: jsonResponse("The site's state", JiraWorldStateSchema),
    401: unauthorized,
  },
});

export const createIssueRoute = createRoute({
  method: "post",
  path: "/_worlds/jira/issues",
  tags,
  servers,
  security,
  summary: "Create an issue",
  description: "Creates the issue as user and sends jira:issue_created to matching webhooks.",
  request: {
    body: { required: true, content: { "application/json": { schema: JiraIssueCreateSchema } } },
  },
  responses: {
    201: jsonResponse("The new issue", JiraIssueSchema),
    400: errorResponse("Invalid fields, or an unknown user, assignee or project"),
    401: unauthorized,
  },
});

export const updateIssueRoute = createRoute({
  method: "patch",
  path: "/_worlds/jira/issues/{key}",
  tags,
  servers,
  security,
  summary: "Update an issue",
  description:
    "Changes the given fields as user and sends jira:issue_updated with the changelog to matching webhooks.",
  request: {
    params: IssueKeyParamsSchema,
    body: { required: true, content: { "application/json": { schema: JiraIssueUpdateSchema } } },
  },
  responses: {
    200: jsonResponse("The issue and what changed", JiraIssueUpdatedSchema),
    400: errorResponse("Invalid fields, or an unknown user or assignee"),
    401: unauthorized,
    404: issueNotFound,
  },
});

export const deleteIssueRoute = createRoute({
  method: "delete",
  path: "/_worlds/jira/issues/{key}",
  tags,
  servers,
  security,
  summary: "Delete an issue",
  description: "Deletes the issue as user and sends jira:issue_deleted to matching webhooks.",
  request: { params: IssueKeyParamsSchema, query: z.object({ user: actor }) },
  responses: {
    204: { description: "Deleted" },
    400: errorResponse("Unknown user"),
    401: unauthorized,
    404: issueNotFound,
  },
});

export const createCommentRoute = createRoute({
  method: "post",
  path: "/_worlds/jira/issues/{key}/comments",
  tags,
  servers,
  security,
  summary: "Comment on an issue",
  description: "Adds the comment as user and sends comment_created to matching webhooks.",
  request: {
    params: IssueKeyParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: JiraCommentCreateSchema } },
    },
  },
  responses: {
    201: jsonResponse("The new comment", JiraCommentSchema),
    400: errorResponse("Empty body or unknown user"),
    401: unauthorized,
    404: issueNotFound,
  },
});

export const jira = defineService({
  name: "jira",
  title: "Jira",
  hosts: ["jira", "jira-auth", "jira-api"],
  spec: JiraSpecSchema,
  state: JiraStateSchema,
  urls: JiraUrlsSchema,
  specProblems: jiraSpecProblems,
  uiUrl: (origin) => origin("jira"),
  urlsFor: (origin) => ({
    site_url: origin("jira"),
    auth_url: origin("jira-auth"),
    api_url: origin("jira-api"),
  }),
  routes: [
    jiraStateRoute,
    createIssueRoute,
    updateIssueRoute,
    deleteIssueRoute,
    createCommentRoute,
  ],
});

export type JiraHost = (typeof jira.hosts)[number];

export function isJiraHost(host: string): host is JiraHost {
  return jira.hosts.some((candidate) => candidate === host);
}
