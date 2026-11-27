import { createRoute, z } from "@hono/zod-openapi";
import {
  defineService,
  errorResponse,
  jsonResponse,
  security,
  userRef,
  worldServer,
} from "@worlds/contract";

import { ISSUE_STATES, LINEAR_SCOPES, linearSpecProblems } from "./spec";

const LinearUserSpecSchema = z
  .object({
    id: z.uuid().optional().openapi({ description: "Pin the user id. Generated if left out." }),
    name: z
      .string()
      .regex(/^[a-z0-9._-]{1,80}$/, {
        error: "user names are lowercase letters, digits, . _ and -",
      })
      .openapi({ description: "The user's handle (Linear's displayName).", example: "alice" }),
    display_name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .openapi({ description: "The user's full name (Linear's name).", example: "Alice Tester" }),
    email: z.email().openapi({ example: "alice@acme.test" }),
  })
  .openapi("LinearUserSpec", { description: "A member of the workspace." });

const LinearTeamSpecSchema = z
  .object({
    id: z.uuid().optional(),
    key: z
      .string()
      .regex(/^[A-Z][A-Z0-9]{0,6}$/, {
        error: "team keys are 1-7 uppercase letters and digits, starting with a letter",
      })
      .openapi({ example: "ENG" }),
    name: z.string().trim().min(1).max(80).openapi({ example: "Engineering" }),
  })
  .openapi("LinearTeamSpec", { description: "A team; issues belong to one." });

const title = z
  .string()
  .trim()
  .min(1, { error: "title can't be empty." })
  .max(255)
  .openapi({ example: "Checkout fails for guest users" });

const state = z.enum(ISSUE_STATES).openapi({ description: "The issue's workflow state." });

const LinearCommentSpecSchema = z
  .object({
    author: userRef,
    body: z.string().min(1).max(32_000).openapi({ example: "Repro'd on staging." }),
  })
  .openapi("LinearCommentSpec", { description: "A comment on the issue, oldest first." });

const LinearIssueSpecSchema = z
  .object({
    team: z.string().openapi({ description: "A team key.", example: "ENG" }),
    title,
    description: z.string().max(32_000).optional().openapi({ description: "Markdown." }),
    state,
    creator: userRef,
    assignee: userRef.optional(),
    comments: z.array(LinearCommentSpecSchema).max(100).optional(),
  })
  .openapi("LinearIssueSpec", { description: "An issue created with the world." });

const LinearCredentialsSchema = z
  .object({
    client_id: z.string().min(8).max(128),
    client_secret: z.string().min(16).max(256),
    webhook_secret: z.string().min(16).max(256),
  })
  .openapi("LinearCredentials", {
    description: "The app's OAuth client credentials and webhook signing secret.",
  });

const LinearAppSpecSchema = z
  .object({
    name: z.string().min(1).max(80).openapi({ example: "My app" }),
    callback_urls: z
      .array(z.string().regex(/^https?:\/\/[^\s]+$/))
      .min(1)
      .max(20)
      .openapi({
        description:
          "OAuth callback URLs. redirect_uri must equal one of them; a * in the host matches one label.",
        example: ["https://example.com/linear/callback"],
      }),
    scopes: z
      .array(z.enum(LINEAR_SCOPES))
      .min(1)
      .openapi({
        description: "Scopes the app may request.",
        example: ["read", "write", "app:assignable", "app:mentionable"],
      }),
    webhook_url: z
      .string()
      .regex(/^https?:\/\/[^\s]+$/)
      .optional()
      .openapi({
        description:
          "Where app webhooks (AppUserNotification, OAuthApp) go once the app is installed, as in the app's settings.",
        example: "https://example.com/linear/events",
      }),
    credentials: LinearCredentialsSchema.partial()
      .openapi("LinearCredentialsSpec", {
        description:
          "Pin the client id, secret and webhook secret, e.g. to match ones your app has.",
      })
      .optional(),
  })
  .openapi("LinearAppSpec", { description: "An OAuth application, as in Linear's API settings." });

const LinearWorkspaceSpecSchema = z
  .object({
    id: z.uuid().optional().openapi({
      description:
        "Pin the organization id, e.g. to match one your app stored. Generated if left out.",
    }),
    name: z.string().trim().min(1).max(80).openapi({ example: "Acme" }),
    url_key: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .openapi({ description: "As in linear.app/<url_key>.", example: "acme" }),
  })
  .openapi("LinearWorkspaceSpec", { description: "The world's Linear workspace (organization)." });

export const LinearSpecSchema = z
  .object({
    workspace: LinearWorkspaceSpecSchema,
    users: z.array(LinearUserSpecSchema).max(200).optional(),
    teams: z.array(LinearTeamSpecSchema).max(50).optional(),
    issues: z.array(LinearIssueSpecSchema).max(500).optional().openapi({
      description: "Created in order before any app is installed, so they send no webhooks.",
    }),
    apps: z.array(LinearAppSpecSchema).max(10).optional(),
  })
  .openapi("LinearSpec", {
    description:
      "Everything in the world's Linear workspace. Omitted ids and credentials are generated. Leave it out to create the world without Linear.",
  });

const LinearWorkspaceStateSchema = z
  .object({ id: z.string(), name: z.string(), url_key: z.string(), url: z.string() })
  .openapi("LinearWorkspaceState", { description: "The workspace, with its id and URL." });

const LinearUserStateSchema = z
  .object({ id: z.string(), name: z.string(), display_name: z.string(), email: z.string() })
  .openapi("LinearUserState", { description: "A user, with its id." });

const LinearTeamStateSchema = z
  .object({ id: z.string(), key: z.string(), name: z.string() })
  .openapi("LinearTeamState", { description: "A team, with its id." });

const LinearIssueStateSchema = LinearIssueSpecSchema.extend({ identifier: z.string() }).openapi(
  "LinearIssueState",
  { description: "An issue from the spec, with the identifier it was given." },
);

const LinearAppStateSchema = z
  .object({
    name: z.string(),
    callback_urls: z.array(z.string()),
    scopes: z.array(z.enum(LINEAR_SCOPES)),
    webhook_url: z.string().nullable(),
    credentials: LinearCredentialsSchema,
  })
  .openapi("LinearAppState", { description: "An app, with its credentials." });

export const LinearStateSchema = z
  .object({
    workspace: LinearWorkspaceStateSchema,
    users: z.array(LinearUserStateSchema),
    teams: z.array(LinearTeamStateSchema),
    issues: z.array(LinearIssueStateSchema),
    apps: z.array(LinearAppStateSchema),
  })
  .openapi("LinearState", {
    description: "The world's Linear spec with every generated id and credential filled in.",
  });

const LinearUrlsSchema = z
  .object({
    app_url: z.url().openapi({
      description:
        "In place of https://linear.app: /oauth/authorize, and issue pages at /<url_key>/issue/<identifier>.",
      example: "https://k2v9x0q1m4-linear.makeworlds.dev",
    }),
    api_url: z.url().openapi({
      description: "In place of https://api.linear.app: /graphql, /oauth/token and /oauth/revoke.",
      example: "https://k2v9x0q1m4-linear-api.makeworlds.dev",
    }),
  })
  .openapi("LinearUrls", { description: "The world's Linear URLs, one per Linear host." });

const LinearIssueSchema = z
  .object({
    id: z.string(),
    identifier: z.string().openapi({ example: "ENG-1" }),
    title: z.string(),
    description: z.string().nullable(),
    url: z.url(),
    state: z.enum(ISSUE_STATES),
    team: z.string().openapi({ description: "The team key." }),
    creator: z.string().openapi({ description: "The creator's user id." }),
    assignee: z
      .string()
      .nullable()
      .openapi({ description: "The assignee's user id, a member or an app user." }),
    created_at: z.string(),
    updated_at: z.string(),
    comments: z.array(
      z
        .object({ id: z.string(), user: z.string(), body: z.string(), created_at: z.string() })
        .openapi("LinearComment", { description: "A comment on an issue." }),
    ),
    reactions: z.array(
      z
        .object({ id: z.string(), user: z.string(), emoji: z.string() })
        .openapi("LinearReaction", { description: "An emoji reaction on an issue." }),
    ),
    attachments: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          subtitle: z.string().nullable(),
          url: z.string(),
        })
        .openapi("LinearAttachment", { description: "A link attached to an issue." }),
    ),
  })
  .openapi("LinearIssue", { description: "An issue as the world stores it." });

const LinearAppUserSchema = z
  .object({
    id: z.string(),
    client_id: z.string(),
    name: z.string(),
    handle: z.string(),
  })
  .openapi("LinearAppUser", {
    description: "The user an app installed with actor=app acts as (viewer for its tokens).",
  });

const LinearWorldStateSchema = z
  .object({
    spec: LinearStateSchema,
    issues: z.array(LinearIssueSchema),
    app_users: z.array(LinearAppUserSchema),
  })
  .openapi("LinearWorldState", {
    description: "The workspace as it is now: its spec, issues and installed app users.",
  });

const actor = userRef.openapi({
  description: "The member who acts: their name or id. Webhooks name them as the actor.",
});

const assignee = userRef.openapi({
  description: "A member's name or id, or an installed app's name to assign the issue to the app.",
});

const LinearIssueCreateSchema = z
  .object({
    user: actor,
    team: z.string().openapi({ description: "A team key.", example: "ENG" }),
    title,
    description: z.string().max(32_000).optional(),
    state,
    assignee: assignee.optional(),
  })
  .openapi("LinearIssueCreate", { description: "An issue to create as a member." });

const LinearIssueUpdateSchema = z
  .object({
    user: actor,
    title: title.optional(),
    description: z.string().max(32_000).nullable().optional(),
    state: state.optional(),
    assignee: assignee.nullable().optional().openapi({ description: "null unassigns the issue." }),
  })
  .openapi("LinearIssueUpdate", { description: "Changes to make to an issue as a member." });

const LinearCommentCreateSchema = z
  .object({ user: actor, body: z.string().min(1).max(32_000) })
  .openapi("LinearCommentCreate", { description: "A comment to post as a member." });

const IdentifierParamsSchema = z.object({
  identifier: z.string().openapi({ param: { name: "identifier", in: "path" }, example: "ENG-1" }),
});

const ClientIdParamsSchema = z.object({
  client_id: z.string().openapi({ param: { name: "client_id", in: "path" } }),
});

const servers = [worldServer("linear")];
const tags = ["Linear world"];
const unauthorized = errorResponse("Missing or invalid credentials, or not your team's world");
const issueNotFound = errorResponse("No issue with that identifier or id");

export const linearStateRoute = createRoute({
  method: "get",
  path: "/_worlds/linear/state",
  tags,
  servers,
  security,
  summary: "Get the Linear workspace's state",
  description: "The spec with generated ids filled in, every issue and the installed app users.",
  responses: {
    200: jsonResponse("The workspace's state", LinearWorldStateSchema),
    401: unauthorized,
  },
});

export const createIssueRoute = createRoute({
  method: "post",
  path: "/_worlds/linear/issues",
  tags,
  servers,
  security,
  summary: "Create an issue",
  description:
    "Creates the issue as user. Assigning it to an app sends that app AppUserNotification issueAssignedToYou.",
  request: {
    body: { required: true, content: { "application/json": { schema: LinearIssueCreateSchema } } },
  },
  responses: {
    201: jsonResponse("The new issue", LinearIssueSchema),
    400: errorResponse("Invalid fields, or an unknown user, assignee or team"),
    401: unauthorized,
  },
});

export const updateIssueRoute = createRoute({
  method: "patch",
  path: "/_worlds/linear/issues/{identifier}",
  tags,
  servers,
  security,
  summary: "Update an issue",
  description:
    "Changes the given fields as user. Assigning to an app sends it issueAssignedToYou; reassigning away sends issueUnassignedFromYou.",
  request: {
    params: IdentifierParamsSchema,
    body: { required: true, content: { "application/json": { schema: LinearIssueUpdateSchema } } },
  },
  responses: {
    200: jsonResponse("The changed issue", LinearIssueSchema),
    400: errorResponse("Invalid fields, or an unknown user or assignee"),
    401: unauthorized,
    404: issueNotFound,
  },
});

export const createCommentRoute = createRoute({
  method: "post",
  path: "/_worlds/linear/issues/{identifier}/comments",
  tags,
  servers,
  security,
  summary: "Comment on an issue",
  description: "Adds the comment as user.",
  request: {
    params: IdentifierParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: LinearCommentCreateSchema } },
    },
  },
  responses: {
    201: jsonResponse("The changed issue", LinearIssueSchema),
    400: errorResponse("Unknown user"),
    401: unauthorized,
    404: issueNotFound,
  },
});

export const revokeAppRoute = createRoute({
  method: "post",
  path: "/_worlds/linear/apps/{client_id}/revoke",
  tags,
  servers,
  security,
  summary: "Uninstall an app",
  description:
    "Revokes every token of the app in this workspace, as an admin removing it, and sends OAuthApp revoked to its webhook URL.",
  request: { params: ClientIdParamsSchema },
  responses: {
    204: { description: "Revoked" },
    401: unauthorized,
    404: errorResponse("No app with that client id"),
  },
});

export const linear = defineService({
  name: "linear",
  title: "Linear",
  hosts: ["linear", "linear-api"],
  spec: LinearSpecSchema,
  state: LinearStateSchema,
  urls: LinearUrlsSchema,
  specProblems: linearSpecProblems,
  starter: {
    workspace: { name: "Acme", url_key: "acme" },
    users: [{ name: "alice", display_name: "Alice Tester", email: "alice@acme.test" }],
    teams: [{ key: "ENG", name: "Engineering" }],
  },
  uiUrl: (origin) => origin("linear"),
  urlsFor: (origin) => ({ app_url: origin("linear"), api_url: origin("linear-api") }),
  routes: [
    linearStateRoute,
    createIssueRoute,
    updateIssueRoute,
    createCommentRoute,
    revokeAppRoute,
  ],
});

export type LinearHost = (typeof linear.hosts)[number];

export function isLinearHost(host: string): host is LinearHost {
  return linear.hosts.some((candidate) => candidate === host);
}
