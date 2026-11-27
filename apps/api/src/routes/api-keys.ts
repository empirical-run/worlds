import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createKey, listKeys, revokeKey, type ApiKey } from "@worlds/db";
import { apiError, type AppEnv } from "../context";
import {
  ApiKeyCreatedSchema,
  ApiKeyCreateSchema,
  ApiKeyListSchema,
  ApiKeyParamsSchema,
  errorResponse,
  jsonResponse,
  security,
  TeamParamsSchema,
} from "../schemas";
import { accessibleTeam } from "../teams";

const listApiKeys = createRoute({
  method: "get",
  path: "/api/teams/{teamId}/api-keys",
  tags: ["API keys"],
  summary: "List API keys",
  description: "Active keys of a team, newest first. Secrets are never returned.",
  security,
  request: { params: TeamParamsSchema },
  responses: {
    200: jsonResponse("The team's keys", ApiKeyListSchema),
    401: errorResponse("Missing or invalid credentials"),
    404: errorResponse("No team with that id is visible to you"),
  },
});

const createApiKey = createRoute({
  method: "post",
  path: "/api/teams/{teamId}/api-keys",
  tags: ["API keys"],
  summary: "Create an API key",
  description: "Team members only, signed in. The response is the only time the secret is shown.",
  security,
  request: {
    params: TeamParamsSchema,
    body: { required: true, content: { "application/json": { schema: ApiKeyCreateSchema } } },
  },
  responses: {
    201: jsonResponse("The new key, with its secret", ApiKeyCreatedSchema),
    400: errorResponse("Invalid name"),
    401: errorResponse("Missing or invalid credentials"),
    403: errorResponse("Called with an API key"),
    404: errorResponse("No team with that id is visible to you"),
  },
});

const revokeApiKey = createRoute({
  method: "delete",
  path: "/api/teams/{teamId}/api-keys/{keyId}",
  tags: ["API keys"],
  summary: "Revoke an API key",
  description: "Team members only, signed in. The key stops working immediately.",
  security,
  request: { params: ApiKeyParamsSchema },
  responses: {
    204: { description: "Revoked" },
    401: errorResponse("Missing or invalid credentials"),
    403: errorResponse("Called with an API key"),
    404: errorResponse("No such active key in a team visible to you"),
  },
});

function apiKeyJson(key: ApiKey) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    created_by: key.createdBy,
    created_at: key.createdAt.toISOString(),
    updated_at: key.updatedAt.toISOString(),
    last_used_at: key.lastUsedAt?.toISOString() ?? null,
  };
}

const KEYS_NEED_SESSION = "API keys cannot manage API keys. Sign in and use the account page or a session.";

export const apiKeys = new OpenAPIHono<AppEnv>()
  .openapi(listApiKeys, async (c) => {
    const access = await accessibleTeam(c.var.db, c.var.caller, c.req.valid("param").teamId);
    if (!access) return c.json(apiError("not_found", "No team with that id is visible to you."), 404);
    const keys = await listKeys(c.var.db, access.team.id);
    return c.json({ api_keys: keys.map(apiKeyJson) }, 200);
  })
  .openapi(createApiKey, async (c) => {
    const { caller } = c.var;
    const access = await accessibleTeam(c.var.db, caller, c.req.valid("param").teamId);
    if (!access) return c.json(apiError("not_found", "No team with that id is visible to you."), 404);
    if (caller.kind === "key") return c.json(apiError("forbidden", KEYS_NEED_SESSION), 403);
    const { apiKey, secret } = await createKey(c.var.db, access.team.id, caller.user.id, c.req.valid("json").name);
    return c.json({ ...apiKeyJson(apiKey), secret }, 201);
  })
  .openapi(revokeApiKey, async (c) => {
    const { teamId, keyId } = c.req.valid("param");
    const access = await accessibleTeam(c.var.db, c.var.caller, teamId);
    if (!access) return c.json(apiError("not_found", "No team with that id is visible to you."), 404);
    if (c.var.caller.kind === "key") return c.json(apiError("forbidden", KEYS_NEED_SESSION), 403);
    if (!(await revokeKey(c.var.db, access.team.id, keyId))) {
      return c.json(apiError("not_found", "No active key with that id in this team."), 404);
    }
    return c.body(null, 204);
  });
