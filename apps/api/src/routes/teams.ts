import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { membersOf, renameTeam } from "@worlds/db";
import { apiError, type AppEnv } from "../context";
import {
  errorResponse,
  jsonResponse,
  security,
  TeamDetailSchema,
  TeamListSchema,
  TeamParamsSchema,
  TeamSchema,
  TeamUpdateSchema,
} from "../schemas";
import { accessibleTeam, accessibleTeams, teamJson } from "../teams";

const listTeams = createRoute({
  method: "get",
  path: "/api/teams",
  tags: ["Teams"],
  summary: "List teams",
  description: "Teams you can see. With an API key, that is the key's team.",
  security,
  responses: {
    200: jsonResponse("Your teams", TeamListSchema),
    401: errorResponse("Missing or invalid credentials"),
  },
});

const getTeam = createRoute({
  method: "get",
  path: "/api/teams/{teamId}",
  tags: ["Teams"],
  summary: "Get a team",
  description: "One team and its members.",
  security,
  request: { params: TeamParamsSchema },
  responses: {
    200: jsonResponse("The team", TeamDetailSchema),
    401: errorResponse("Missing or invalid credentials"),
    404: errorResponse("No team with that id is visible to you"),
  },
});

const updateTeam = createRoute({
  method: "patch",
  path: "/api/teams/{teamId}",
  tags: ["Teams"],
  summary: "Rename a team",
  description: "Team owners only, signed in. API keys cannot change teams.",
  security,
  request: {
    params: TeamParamsSchema,
    body: { required: true, content: { "application/json": { schema: TeamUpdateSchema } } },
  },
  responses: {
    200: jsonResponse("The renamed team", TeamSchema),
    400: errorResponse("Invalid name"),
    401: errorResponse("Missing or invalid credentials"),
    403: errorResponse("Not a team owner, or called with an API key"),
    404: errorResponse("No team with that id is visible to you"),
  },
});

export const teams = new OpenAPIHono<AppEnv>()
  .openapi(listTeams, async (c) => {
    const visible = await accessibleTeams(c.var.db, c.var.caller);
    return c.json({ teams: visible.map(teamJson) }, 200);
  })
  .openapi(getTeam, async (c) => {
    const access = await accessibleTeam(c.var.db, c.var.caller, c.req.valid("param").teamId);
    if (!access) return c.json(apiError("not_found", "No team with that id is visible to you."), 404);
    const members = await membersOf(c.var.db, access.team.id);
    return c.json(
      {
        ...teamJson(access),
        members: members.map(({ user, role }) => ({ id: user.id, email: user.email, name: user.name, role })),
      },
      200,
    );
  })
  .openapi(updateTeam, async (c) => {
    const access = await accessibleTeam(c.var.db, c.var.caller, c.req.valid("param").teamId);
    if (!access) return c.json(apiError("not_found", "No team with that id is visible to you."), 404);
    if (c.var.caller.kind === "key") return c.json(apiError("forbidden", "API keys cannot change teams. Sign in as a team owner."), 403);
    if (access.role !== "owner") return c.json(apiError("forbidden", "Only team owners can change the team."), 403);
    const { name } = c.req.valid("json");
    const team = await renameTeam(c.var.db, access.team.id, name);
    return c.json(teamJson({ ...access, team }), 200);
  });
