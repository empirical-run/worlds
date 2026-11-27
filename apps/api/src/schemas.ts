import { z } from "@hono/zod-openapi";
import { API_KEY_NAME_MAX, TEAM_NAME_MAX, WORLD_NAME_MAX } from "@worlds/db";
import { JiraSpecSchema, JiraStateSchema } from "@worlds/jira/contract";

const Role = z.enum(["owner", "member"]);

function name(max: number) {
  return z
    .string({ error: "name is required." })
    .trim()
    .min(1, { error: "name can't be empty." })
    .max(max, { error: `name can be at most ${max} characters.` });
}

export const TeamSchema = z
  .object({
    id: z.string().openapi({ example: "team_k2v9x0q1m4s7d8f3a6b5" }),
    name: z.string().openapi({ example: "Empirical" }),
    role: Role.nullable().openapi({
      description:
        "Your role in the team. null when the request is authenticated with an API key, which belongs to the team rather than a person.",
    }),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .openapi("Team");

export const MemberSchema = z
  .object({
    id: z.string().openapi({ example: "user_p0r7w2c9n5h1j4k8l3m6" }),
    email: z.email(),
    name: z.string().nullable(),
    role: Role,
  })
  .openapi("Member");

export const TeamDetailSchema = TeamSchema.extend({ members: z.array(MemberSchema) }).openapi(
  "TeamDetail",
);

export const TeamListSchema = z.object({ teams: z.array(TeamSchema) }).openapi("TeamList");

export const TeamUpdateSchema = z
  .object({ name: name(TEAM_NAME_MAX).openapi({ example: "Empirical" }) })
  .openapi("TeamUpdate");

export const ApiKeySchema = z
  .object({
    id: z.string().openapi({ example: "key_w2rh3pmnhl1pe2wjxgqs" }),
    name: z.string().openapi({ example: "CI" }),
    prefix: z.string().openapi({
      description: "The first characters of the secret, to tell keys apart.",
      example: "wk_live_4fQ9zT",
    }),
    created_by: z
      .string()
      .nullable()
      .openapi({ description: "Id of the user who created the key." }),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    last_used_at: z.iso.datetime().nullable(),
  })
  .openapi("ApiKey");

export const ApiKeyListSchema = z.object({ api_keys: z.array(ApiKeySchema) }).openapi("ApiKeyList");

export const ApiKeyCreateSchema = z
  .object({ name: name(API_KEY_NAME_MAX).openapi({ example: "CI" }) })
  .openapi("ApiKeyCreate");

export const ApiKeyCreatedSchema = ApiKeySchema.extend({
  secret: z.string().openapi({
    description: "The key itself. Shown only in this response.",
    example: "wk_live_4fQ9zTb1Lx7mKc2RyV8nHs0dWq5ePj3uGa6oNi9E",
  }),
}).openapi("ApiKeyCreated");

export const WorldSchema = z
  .object({
    id: z.string().openapi({ example: "world_k2v9x0q1m4" }),
    name: z.string().openapi({ example: "Thread routing eval" }),
    team_id: z.string().openapi({ example: "team_k2v9x0q1m4s7d8f3a6b5" }),
    created_by: z.string().nullable().openapi({
      description: "Id of the user who created the world. null when an API key created it.",
    }),
    slack: z.object({
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
    }),
    jira: z.object({
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
    }),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .openapi("World");

export const WorldListSchema = z.object({ worlds: z.array(WorldSchema) }).openapi("WorldList");

const SlackCredentialsSchema = z
  .object({
    client_id: z.string(),
    client_secret: z.string(),
    signing_secret: z.string(),
    verification_token: z.string(),
  })
  .openapi("SlackCredentials");

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
    real_name: z.string().max(200).optional().openapi({ example: "Alice Tester" }),
    email: z.email().optional(),
    token: z
      .string()
      .startsWith("xoxp-")
      .optional()
      .openapi({ description: "Pin the user's token, to act as them with any Slack client." }),
  })
  .openapi("SlackUserSpec");

const SlackMessageSpecSchema = z
  .object({
    user: z.string().openapi({ description: "A user's name or id.", example: "alice" }),
    text: z.string().max(40_000).openapi({ example: "Deploy failed on main, can someone look?" }),
    replies: z
      .array(z.object({ user: z.string(), text: z.string().max(40_000) }))
      .max(100)
      .optional(),
  })
  .openapi("SlackMessageSpec");

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
    members: z.array(z.string()).max(500).optional().openapi({ description: "User names or ids." }),
    messages: z.array(SlackMessageSpecSchema).max(500).optional().openapi({
      description: "Posted in order before any app is installed, so they send no events.",
    }),
  })
  .openapi("SlackChannelSpec");

const SlackInstallSpecSchema = z
  .object({
    installer: z
      .string()
      .optional()
      .openapi({ description: "The user who installs the app. Defaults to the first user." }),
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
  .openapi("SlackInstallSpec");

const SlackAppSpecSchema = z
  .object({
    manifest: z.record(z.string(), z.unknown()).openapi({
      description:
        "A Slack app manifest (JSON). Its redirect_urls, scopes, event_subscriptions and interactivity apply in this world.",
      example: {
        display_information: { name: "My app" },
        features: { bot_user: { display_name: "my-app" } },
        oauth_config: { scopes: { bot: ["app_mentions:read", "chat:write", "channels:history"] } },
        settings: {
          event_subscriptions: {
            request_url: "https://example.com/slack/events",
            bot_events: ["app_mention"],
          },
        },
      },
    }),
    credentials: SlackCredentialsSchema.partial().optional().openapi({
      description:
        "Pin some or all credentials, e.g. to match secrets your app already has. Real Slack generates them; worlds lets you choose.",
    }),
    install: z
      .union([z.boolean(), SlackInstallSpecSchema])
      .optional()
      .openapi({ description: "Install the app into the world's workspace. true uses defaults." }),
  })
  .openapi("SlackAppSpec");

export const SlackSpecSchema = z
  .object({
    team: z
      .object({
        id: slackId("T", "T0WORLDS0001").optional(),
        name: z.string().max(80).optional(),
        domain: z
          .string()
          .regex(/^[a-z0-9-]{1,40}$/)
          .optional(),
      })
      .optional(),
    users: z.array(SlackUserSpecSchema).max(200).optional(),
    channels: z.array(SlackChannelSpecSchema).max(200).optional(),
    apps: z.array(SlackAppSpecSchema).max(10).optional(),
  })
  .openapi("SlackSpec", {
    description:
      "Everything in the world's Slack workspace. Omitted ids, credentials and tokens are generated. Without a spec the world gets one user (alice) and #general.",
  });

const SlackStateSchema = z
  .object({
    team: z.object({ id: z.string(), name: z.string(), domain: z.string() }),
    users: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        real_name: z.string(),
        email: z.string(),
        token: z.string().nullable(),
      }),
    ),
    channels: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        private: z.boolean(),
        topic: z.string(),
        members: z.array(z.string()),
        messages: z.array(SlackMessageSpecSchema),
      }),
    ),
    apps: z.array(
      z.object({
        app_id: z.string(),
        manifest: z.record(z.string(), z.unknown()),
        credentials: SlackCredentialsSchema,
        install: z
          .object({
            installer: z.string(),
            bot_user_id: z.string(),
            bot_token: z.string(),
            channels: z.array(z.string()),
          })
          .nullable(),
      }),
    ),
  })
  .openapi("SlackState", {
    description:
      "The world's spec with every generated id, credential and token filled in. Create a world from it to get an identical one.",
  });

export const WorldCreatedSchema = WorldSchema.extend({
  slack: WorldSchema.shape.slack.extend({ spec: SlackStateSchema }),
  jira: WorldSchema.shape.jira.extend({ spec: JiraStateSchema }),
}).openapi("WorldCreated");

export const WorldSpecSchema = z
  .object({ slack: SlackStateSchema, jira: JiraStateSchema.nullable() })
  .openapi("WorldSpec");

export const WorldCreateSchema = z
  .object({
    name: name(WORLD_NAME_MAX)
      .optional()
      .openapi({ description: "Defaults to Untitled world.", example: "Thread routing eval" }),
    slack: SlackSpecSchema.optional(),
    jira: JiraSpecSchema.optional(),
  })
  .openapi("WorldCreate");

export const WorldParamsSchema = z.object({
  worldId: z
    .string()
    .openapi({ param: { name: "worldId", in: "path" }, example: "world_k2v9x0q1m4" }),
});

export const TeamParamsSchema = z.object({
  teamId: z
    .string()
    .openapi({ param: { name: "teamId", in: "path" }, example: "team_k2v9x0q1m4s7d8f3a6b5" }),
});

export const ApiKeyParamsSchema = TeamParamsSchema.extend({
  keyId: z
    .string()
    .openapi({ param: { name: "keyId", in: "path" }, example: "key_w2rh3pmnhl1pe2wjxgqs" }),
});
