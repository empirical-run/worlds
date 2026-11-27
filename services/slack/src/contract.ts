import { createRoute, z } from "@hono/zod-openapi";
import {
  defineService,
  errorResponse,
  jsonResponse,
  security,
  userRef,
  worldServer,
} from "@worlds/contract";

import { SlackCredentialsSchema, SlackManifestSchema } from "./manifest";
import { ACTING_METHODS, slackSpecProblems } from "./spec";

const slackId = (prefix: string, example: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}[0-9A-Z]{2,20}$`), {
      error: `must look like a Slack id starting with ${prefix}`,
    })
    .openapi({ example });

const SlackUserSpecSchema = z
  .object({
    id: slackId("U", "U0ALICE00001").optional(),
    name: z
      .string()
      .regex(/^[a-z0-9._-]{1,80}$/, {
        error: "user names are lowercase letters, digits, . _ and -",
      })
      .openapi({ example: "alice" }),
    real_name: z.string().trim().min(1).max(200).openapi({ example: "Alice Tester" }),
    email: z.email().openapi({ example: "alice@acme.test" }),
    token: z
      .string()
      .startsWith("xoxp-")
      .optional()
      .openapi({ description: "Pin the user's token, to act as them with any Slack client." }),
  })
  .openapi("SlackUserSpec", { description: "A person in the workspace." });

const SlackReplySpecSchema = z
  .object({
    user: userRef,
    text: z.string().max(40_000).openapi({ example: "Looking now." }),
  })
  .openapi("SlackReplySpec", { description: "A reply in the message's thread." });

const SlackMessageSpecSchema = z
  .object({
    user: userRef,
    text: z.string().max(40_000).openapi({ example: "Deploy failed on main, can someone look?" }),
    replies: z.array(SlackReplySpecSchema).max(100).optional(),
  })
  .openapi("SlackMessageSpec", { description: "A message posted when the world is created." });

const SlackChannelSpecSchema = z
  .object({
    id: z
      .string()
      .regex(/^[CG][0-9A-Z]{2,20}$/)
      .optional()
      .openapi({ example: "C0GENERAL001" }),
    name: z
      .string()
      .regex(/^[a-z0-9_-]{1,80}$/, {
        error: "channel names are lowercase letters, digits, _ and -",
      })
      .openapi({ example: "general" }),
    private: z.boolean().optional(),
    topic: z.string().max(250).optional(),
    members: z.array(z.string()).min(1).max(500).openapi({
      description: "User names or ids. The first member created the channel.",
    }),
    messages: z.array(SlackMessageSpecSchema).max(500).optional().openapi({
      description: "Posted in order before any app is installed, so they send no events.",
    }),
  })
  .openapi("SlackChannelSpec", { description: "A channel, its members and its first messages." });

const SlackInstallSpecSchema = z
  .object({
    installer: z.string().openapi({ description: "The user (name or id) who installs the app." }),
    bot_user_id: slackId("U", "U0EMPIRICAL1").optional(),
    bot_token: z.string().startsWith("xoxb-").optional().openapi({
      description:
        "Pin the bot token, so a recreated world matches tokens your app already stored.",
    }),
    channels: z
      .array(z.string())
      .max(100)
      .optional()
      .openapi({ description: "Channel names the bot is a member of." }),
  })
  .openapi("SlackInstallSpec", { description: "Installs the app when the world is created." });

const SlackAppSpecSchema = z
  .object({
    manifest: SlackManifestSchema,
    credentials: SlackCredentialsSchema.partial()
      .openapi("SlackCredentialsSpec", {
        description:
          "Pin some or all credentials, e.g. to match secrets your app already has. Real Slack generates them; worlds lets you choose.",
      })
      .optional(),
    install: SlackInstallSpecSchema.optional().openapi({
      description: "Install the app into the world's workspace.",
    }),
  })
  .openapi("SlackAppSpec", { description: "A Slack app, defined by its manifest." });

const SlackTeamSpecSchema = z
  .object({
    id: slackId("T", "T0ACME00001").optional().openapi({
      description:
        "Pin the team id, e.g. to match installs your app already stored. Generated if left out.",
    }),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .openapi({ description: "The workspace name.", example: "Acme" }),
    domain: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .openapi({
        description: "The workspace subdomain.",
        example: "acme",
      }),
  })
  .openapi("SlackTeamSpec", { description: "The world's Slack workspace." });

export const SlackSpecSchema = z
  .object({
    team: SlackTeamSpecSchema,
    users: z.array(SlackUserSpecSchema).max(200).optional(),
    channels: z.array(SlackChannelSpecSchema).max(200).optional(),
    apps: z.array(SlackAppSpecSchema).max(10).optional(),
  })
  .openapi("SlackSpec", {
    description:
      "Everything in the world's Slack workspace. Omitted ids, credentials and tokens are generated. Leave it out to create the world without Slack.",
  });

const SlackTeamStateSchema = z
  .object({ id: z.string(), name: z.string(), domain: z.string() })
  .openapi("SlackTeamState", { description: "The workspace, with its id." });

const SlackUserStateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    real_name: z.string(),
    email: z.string(),
    token: z
      .string()
      .nullable()
      .openapi({ description: "The pinned user token. null when none was pinned." }),
  })
  .openapi("SlackUserState", { description: "A user, with every generated field filled in." });

const SlackChannelStateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    private: z.boolean(),
    topic: z.string(),
    members: z.array(z.string()).openapi({ description: "User ids." }),
    messages: z.array(SlackMessageSpecSchema),
  })
  .openapi("SlackChannelState", { description: "A channel, with its id and member ids." });

const SlackInstallStateSchema = z
  .object({
    installer: z.string().openapi({ description: "The installing user's id." }),
    bot_user_id: z.string(),
    bot_token: z.string(),
    channels: z.array(z.string()).openapi({ description: "Channel names the bot is a member of." }),
  })
  .openapi("SlackInstallState", { description: "How the app was installed, with its bot token." });

const SlackAppStateSchema = z
  .object({
    app_id: z.string(),
    manifest: SlackManifestSchema,
    credentials: SlackCredentialsSchema,
    install: SlackInstallStateSchema.nullable().openapi({
      description: "null when the spec didn't install the app.",
    }),
  })
  .openapi("SlackAppState", { description: "An app, with all its credentials." });

export const SlackStateSchema = z
  .object({
    team: SlackTeamStateSchema,
    users: z.array(SlackUserStateSchema),
    channels: z.array(SlackChannelStateSchema),
    apps: z.array(SlackAppStateSchema),
  })
  .openapi("SlackState", {
    description:
      "The world's spec with every generated id, credential and token filled in. Create a world from it to get an identical one.",
  });

const SlackUrlsSchema = z
  .object({
    api_url: z.url().openapi({
      description: "Use as the Slack Web API base URL, e.g. slackApiUrl in @slack/web-api.",
      example: "https://k2v9x0q1m4-slack.makeworlds.dev/api/",
    }),
    oauth_authorize_url: z.url().openapi({
      description: "Send users here instead of slack.com/oauth/v2/authorize to install your app.",
      example: "https://k2v9x0q1m4-slack.makeworlds.dev/oauth/v2/authorize",
    }),
    ui_url: z.url().openapi({
      description: "The world's Slack UI.",
      example: "https://k2v9x0q1m4-slack.makeworlds.dev/",
    }),
  })
  .openapi("SlackUrls", { description: "The world's Slack URLs." });

const SlackFileRefSchema = z
  .object({ id: z.string(), name: z.string(), mimetype: z.string(), size: z.number().int() })
  .openapi("SlackFileRef", { description: "A file shared in a message." });

const SlackReactionSchema = z
  .object({
    name: z.string().openapi({ description: "The emoji name.", example: "eyes" }),
    users: z.array(z.string()).openapi({ description: "Ids of the users who reacted." }),
    count: z.number().int(),
  })
  .openapi("SlackReaction", { description: "An emoji reaction on a message." });

const SlackImageSchema = z
  .object({ file_id: z.string().optional(), url: z.string().optional(), alt: z.string() })
  .openapi("SlackImage", { description: "An image in a message, from a file or a block." });

const SlackWorldTeamSchema = z
  .object({ id: z.string(), name: z.string() })
  .openapi("SlackWorldTeam", { description: "The workspace." });

const SlackWorldUserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    real_name: z.string(),
    is_bot: z.boolean(),
    has_token: z.boolean().openapi({ description: "Whether the user can be acted as." }),
  })
  .openapi("SlackWorldUser", { description: "A user or bot in the workspace now." });

const SlackWorldChannelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    is_private: z.boolean(),
    topic: z.string(),
    members: z.array(z.string()).openapi({ description: "User ids." }),
  })
  .openapi("SlackWorldChannel", { description: "A channel in the workspace now." });

const SlackMessageSchema = z
  .object({
    ts: z.string(),
    thread_ts: z.string().optional(),
    user: z.string(),
    text: z.string(),
    reply_count: z.number().int(),
    reply_users: z.array(z.string()),
    reactions: z.array(SlackReactionSchema),
    bot_name: z.string().optional(),
    edited: z.boolean(),
    files: z.array(SlackFileRefSchema),
    images: z.array(SlackImageSchema),
  })
  .openapi("SlackMessage", { description: "A message as the world's Slack UI shows it." });

const SlackWorldStateSchema = z
  .object({
    team: SlackWorldTeamSchema,
    users: z.array(SlackWorldUserSchema),
    channels: z.array(SlackWorldChannelSchema),
    messages: z
      .array(SlackMessageSchema)
      .openapi({ description: "The channel's messages, oldest first. Empty without channel." }),
  })
  .openapi("SlackWorldState", {
    description: "The workspace as it is now, and one channel's messages.",
  });

export type SlackWorldState = z.output<typeof SlackWorldStateSchema>;

const SlackWebApiResponseSchema = z
  .looseObject({ ok: z.boolean(), error: z.string().optional() })
  .openapi("SlackWebApiResponse", {
    description:
      "The Slack Web API's response, as is: ok false with an error is a Slack error, not a failed request.",
  });

export type SlackWebApiResponse = z.output<typeof SlackWebApiResponseSchema>;

const actor = userRef.openapi({
  description: "The user who acts: their name or id. Bots can't be acted as.",
});

const SlackTokenRequestSchema = z
  .object({ user: actor })
  .openapi("SlackTokenRequest", { description: "Whose token to get." });

const SlackTokenSchema = z
  .object({
    user_id: z.string().openapi({ example: "U0ALICE00001" }),
    token: z.string().openapi({ example: "xoxp-worlds-0b6c…" }),
  })
  .openapi("SlackToken", { description: "A user token, to call the Web API as that user." });

export const SlackActRequestSchema = z
  .object({
    user: actor,
    method: z.enum(ACTING_METHODS).openapi({ example: "chat.postMessage" }),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({
        description: "The method's arguments, as the Web API takes them.",
        example: { channel: "C0GENERAL001", text: "Hey <@U0EMPIRICAL1>, can you take a look?" },
      }),
  })
  .openapi("SlackActRequest", { description: "A Web API call to make as a user." });

const SlackUploadRequestSchema = z
  .object({
    user: actor,
    channel: z.string().min(1).openapi({ description: "A channel id.", example: "C0GENERAL001" }),
    file: z.instanceof(File).openapi({ type: "string", format: "binary" }),
    text: z.string().optional().openapi({ description: "A message to share the file with." }),
    thread_ts: z.string().optional().openapi({ description: "Share it in this thread." }),
  })
  .openapi("SlackUploadRequest", { description: "A file to share as a user." });

const servers = [worldServer("slack")];
const tags = ["Slack world"];
const unauthorized = errorResponse("Missing or invalid credentials, or not your team's world");

export const tokenRoute = createRoute({
  method: "post",
  path: "/_worlds/slack/tokens",
  tags,
  servers,
  security,
  summary: "Get a user token",
  description:
    "A user token to act as the user with any Slack client. Minted on first use, then the same token.",
  request: {
    body: { required: true, content: { "application/json": { schema: SlackTokenRequestSchema } } },
  },
  responses: {
    200: jsonResponse("The user's token", SlackTokenSchema),
    400: errorResponse("Unknown user, or a bot"),
    401: unauthorized,
  },
});

export const stateRoute = createRoute({
  method: "get",
  path: "/_worlds/slack/state",
  tags,
  servers,
  security,
  summary: "Get the workspace's state",
  description: "Users, channels and, with channel, that channel's messages.",
  request: {
    query: z.object({
      channel: z
        .string()
        .optional()
        .openapi({ description: "A channel id.", example: "C0GENERAL001" }),
    }),
  },
  responses: {
    200: jsonResponse("The workspace", SlackWorldStateSchema),
    401: unauthorized,
  },
});

export const actRoute = createRoute({
  method: "post",
  path: "/_worlds/slack/act",
  tags,
  servers,
  security,
  summary: "Call a Web API method as a user",
  description:
    "Calls method as the user, minting their token if needed, and sends the events Slack would, e.g. app_mention for a message that mentions your app.",
  request: {
    body: { required: true, content: { "application/json": { schema: SlackActRequestSchema } } },
  },
  responses: {
    200: jsonResponse("The method's response", SlackWebApiResponseSchema),
    400: errorResponse("A method that can't be called this way, or an unknown user"),
    401: unauthorized,
  },
});

export const uploadRoute = createRoute({
  method: "post",
  path: "/_worlds/slack/upload",
  tags,
  servers,
  security,
  summary: "Share a file as a user",
  description: "Uploads the file and shares it in the channel, as files.uploadV2 does.",
  request: {
    body: {
      required: true,
      content: { "multipart/form-data": { schema: SlackUploadRequestSchema } },
    },
  },
  responses: {
    200: jsonResponse("files.completeUploadExternal's response", SlackWebApiResponseSchema),
    400: errorResponse("Missing fields or an unknown user"),
    401: unauthorized,
    502: errorResponse("The upload failed"),
  },
});

export const fileRoute = createRoute({
  method: "get",
  path: "/_worlds/slack/files/{fileId}",
  tags,
  servers,
  security,
  summary: "Download a file",
  request: {
    params: z.object({
      fileId: z.string().openapi({ param: { name: "fileId", in: "path" }, example: "F0A1B2C3D4" }),
    }),
  },
  responses: {
    200: {
      description: "The file's bytes, with its mimetype as content-type",
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
    },
    401: unauthorized,
    404: errorResponse("No file with that id"),
  },
});

export const slack = defineService({
  name: "slack",
  title: "Slack",
  hosts: ["slack"],
  spec: SlackSpecSchema,
  state: SlackStateSchema,
  urls: SlackUrlsSchema,
  specProblems: slackSpecProblems,
  starter: {
    team: { name: "Acme", domain: "acme" },
    users: [{ name: "alice", real_name: "Alice Tester", email: "alice@acme.test" }],
    channels: [{ name: "general", topic: "General discussion", members: ["alice"] }],
  },
  uiUrl: (origin) => `${origin("slack")}/`,
  urlsFor: (origin) => ({
    api_url: `${origin("slack")}/api/`,
    oauth_authorize_url: `${origin("slack")}/oauth/v2/authorize`,
    ui_url: `${origin("slack")}/`,
  }),
  routes: [tokenRoute, stateRoute, actRoute, uploadRoute, fileRoute],
});
