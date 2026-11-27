import { z } from "@hono/zod-openapi";
import { API_KEY_NAME_MAX, TEAM_NAME_MAX } from "@worlds/db";

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string().openapi({ example: "No team with that id is visible to you." }),
    }),
  })
  .openapi("Error");

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
      description: "Your role in the team. null when the request is authenticated with an API key, which belongs to the team rather than a person.",
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

export const TeamDetailSchema = TeamSchema.extend({ members: z.array(MemberSchema) }).openapi("TeamDetail");

export const TeamListSchema = z.object({ teams: z.array(TeamSchema) }).openapi("TeamList");

export const TeamUpdateSchema = z
  .object({ name: name(TEAM_NAME_MAX).openapi({ example: "Empirical" }) })
  .openapi("TeamUpdate");

export const ApiKeySchema = z
  .object({
    id: z.string().openapi({ example: "key_w2rh3pmnhl1pe2wjxgqs" }),
    name: z.string().openapi({ example: "CI" }),
    prefix: z.string().openapi({ description: "The first characters of the secret, to tell keys apart.", example: "wk_live_4fQ9zT" }),
    created_by: z.string().nullable().openapi({ description: "Id of the user who created the key." }),
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
  secret: z.string().openapi({ description: "The key itself. Shown only in this response.", example: "wk_live_4fQ9zTb1Lx7mKc2RyV8nHs0dWq5ePj3uGa6oNi9E" }),
}).openapi("ApiKeyCreated");

export const TeamParamsSchema = z.object({
  teamId: z.string().openapi({ param: { name: "teamId", in: "path" }, example: "team_k2v9x0q1m4s7d8f3a6b5" }),
});

export const ApiKeyParamsSchema = TeamParamsSchema.extend({
  keyId: z.string().openapi({ param: { name: "keyId", in: "path" }, example: "key_w2rh3pmnhl1pe2wjxgqs" }),
});

export const security: Record<string, string[]>[] = [{ bearerAuth: [] }, { sessionCookie: [] }];

export function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorSchema } } };
}

export function jsonResponse<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}

export type TeamJson = z.infer<typeof TeamSchema>;
export type TeamDetailJson = z.infer<typeof TeamDetailSchema>;
export type ApiKeyJson = z.infer<typeof ApiKeySchema>;
export type ApiKeyListJson = z.infer<typeof ApiKeyListSchema>;
export type ApiKeyCreatedJson = z.infer<typeof ApiKeyCreatedSchema>;
