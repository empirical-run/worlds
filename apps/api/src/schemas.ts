import { z } from "@hono/zod-openapi";
import { API_KEY_NAME_MAX, TEAM_NAME_MAX, WORLD_NAME_MAX } from "@worlds/db";
import {
  createdShape,
  specShape,
  stateShape,
  urlsShape,
  worldUiDescription,
  WorldServiceSchema,
} from "@worlds/services";

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
  .openapi("Team", { description: "A team. Worlds and API keys belong to a team." });

export const MemberSchema = z
  .object({
    id: z.string().openapi({ example: "user_p0r7w2c9n5h1j4k8l3m6" }),
    email: z.email(),
    name: z.string().nullable(),
    role: Role,
  })
  .openapi("Member", { description: "A person in a team." });

export const TeamDetailSchema = TeamSchema.extend({ members: z.array(MemberSchema) }).openapi(
  "TeamDetail",
  { description: "A team with its members." },
);

export const TeamListSchema = z
  .object({ teams: z.array(TeamSchema) })
  .openapi("TeamList", { description: "The teams you can see." });

export const TeamUpdateSchema = z
  .object({ name: name(TEAM_NAME_MAX).openapi({ example: "Empirical" }) })
  .openapi("TeamUpdate", { description: "New values for a team." });

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
  .openapi("ApiKey", {
    description: "An API key. The secret itself is shown only when the key is created.",
  });

export const ApiKeyListSchema = z
  .object({ api_keys: z.array(ApiKeySchema) })
  .openapi("ApiKeyList", { description: "The team's API keys, without their secrets." });

export const ApiKeyCreateSchema = z
  .object({ name: name(API_KEY_NAME_MAX).openapi({ example: "CI" }) })
  .openapi("ApiKeyCreate", { description: "A new API key." });

export const ApiKeyCreatedSchema = ApiKeySchema.extend({
  secret: z.string().openapi({
    description: "The key itself. Shown only in this response.",
    example: "wk_live_4fQ9zTb1Lx7mKc2RyV8nHs0dWq5ePj3uGa6oNi9E",
  }),
}).openapi("ApiKeyCreated", { description: "A new API key with its secret." });

export const WorldSchema = z
  .object({
    id: z.string().openapi({ example: "world_k2v9x0q1m4" }),
    name: z.string().openapi({ example: "Thread routing eval" }),
    team_id: z.string().openapi({ example: "team_k2v9x0q1m4s7d8f3a6b5" }),
    created_by: z.string().nullable().openapi({
      description: "Id of the user who created the world. null when an API key created it.",
    }),
    ui_url: z.url().openapi({
      description: worldUiDescription,
      example: "https://k2v9x0q1m4-slack.makeworlds.dev/",
    }),
    services: z.array(WorldServiceSchema).openapi({
      description: "The services in this world, each with its UI.",
    }),
    ...urlsShape,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .openapi("World", {
    description: "A world: private copies of the services your app talks to, with their URLs.",
  });

export const WorldListSchema = z
  .object({ worlds: z.array(WorldSchema) })
  .openapi("WorldList", { description: "The worlds you can see." });

export const WorldCreatedSchema = WorldSchema.extend(createdShape).openapi("WorldCreated", {
  description: "A new world, with each service's URLs and effective spec.",
});

export const WorldSpecSchema = z.object(stateShape).openapi("WorldSpec", {
  description: "Each service's spec, or null for a service the world was created without.",
});

export const WorldCreateSchema = z
  .object({
    name: name(WORLD_NAME_MAX)
      .optional()
      .openapi({ description: "Defaults to Untitled world.", example: "Thread routing eval" }),
    ...specShape,
  })
  .openapi("WorldCreate", {
    description: "A new world. Give a spec for each service it should have.",
  });

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
