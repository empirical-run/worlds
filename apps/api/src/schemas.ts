import { z } from "@hono/zod-openapi";
import { API_KEY_NAME_MAX, TEAM_NAME_MAX, WORLD_NAME_MAX } from "@worlds/db";
import { JiraSpecSchema, JiraStateSchema } from "@worlds/jira/contract";
import { SlackSpecSchema, SlackStateSchema } from "@worlds/slack/contract";

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
