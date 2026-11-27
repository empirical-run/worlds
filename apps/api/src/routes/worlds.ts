import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createWorld, listWorlds, liveWorld, markWorldDeleted, worldHost, type World } from "@worlds/db";
import { apiError, type AppEnv } from "../context";
import { validateManifest, type SlackManifest } from "@worlds/slack/manifest";
import {
  errorResponse,
  jsonResponse,
  security,
  WorldCreatedSchema,
  WorldCreateSchema,
  WorldListSchema,
  WorldParamsSchema,
  WorldSchema,
} from "../schemas";
import { accessibleTeam, accessibleTeams } from "../teams";

const listWorldsRoute = createRoute({
  method: "get",
  path: "/api/worlds",
  tags: ["Worlds"],
  summary: "List worlds",
  description: "Worlds in the teams you can see, newest first. Deleted worlds are not listed.",
  security,
  responses: {
    200: jsonResponse("Your worlds", WorldListSchema),
    401: errorResponse("Missing or invalid credentials"),
  },
});

const createWorldRoute = createRoute({
  method: "post",
  path: "/api/worlds",
  tags: ["Worlds"],
  summary: "Create a world",
  description: "A new, empty world with a seeded Slack workspace. Point your app at the returned URLs.",
  security,
  request: { body: { required: false, content: { "application/json": { schema: WorldCreateSchema } } } },
  responses: {
    201: jsonResponse("The new world, with credentials and bot tokens for its Slack apps", WorldCreatedSchema),
    400: errorResponse("Invalid name or Slack app manifest"),
    401: errorResponse("Missing or invalid credentials"),
    404: errorResponse("No team with that id is visible to you"),
  },
});

const getWorldRoute = createRoute({
  method: "get",
  path: "/api/worlds/{worldId}",
  tags: ["Worlds"],
  summary: "Get a world",
  security,
  request: { params: WorldParamsSchema },
  responses: {
    200: jsonResponse("The world", WorldSchema),
    401: errorResponse("Missing or invalid credentials"),
    404: errorResponse("No world with that id is visible to you"),
  },
});

const deleteWorldRoute = createRoute({
  method: "delete",
  path: "/api/worlds/{worldId}",
  tags: ["Worlds"],
  summary: "Delete a world",
  description: "Wipes everything in the world right away. Its URLs stop working and the id is never reused.",
  security,
  request: { params: WorldParamsSchema },
  responses: {
    204: { description: "Deleted" },
    401: errorResponse("Missing or invalid credentials"),
    404: errorResponse("No world with that id is visible to you"),
  },
});

function worldJson(world: World, domain: string) {
  const base = `https://${worldHost(world.id, "slack", domain)}`;
  return {
    id: world.id,
    name: world.name,
    team_id: world.teamId,
    created_by: world.createdBy,
    slack: { api_url: `${base}/api/`, oauth_authorize_url: `${base}/oauth/v2/authorize`, ui_url: `${base}/` },
    created_at: world.createdAt.toISOString(),
    updated_at: world.updatedAt.toISOString(),
  };
}

const NOT_VISIBLE = "No world with that id is visible to you.";

export const worlds = new OpenAPIHono<AppEnv>()
  .openapi(listWorldsRoute, async (c) => {
    const teams = await accessibleTeams(c.var.db, c.var.caller);
    const found = await listWorlds(c.var.db, teams.map(({ team }) => team.id));
    return c.json({ worlds: found.map((world) => worldJson(world, c.env.WORLDS_DOMAIN)) }, 200);
  })
  .openapi(createWorldRoute, async (c) => {
    const { caller, db } = c.var;
    const body = c.req.valid("json") ?? {};
    const teams = await accessibleTeams(db, caller);
    const target = body.team_id ? await accessibleTeam(db, caller, body.team_id) : teams[0];
    if (!target) return c.json(apiError("not_found", "No team with that id is visible to you."), 404);
    const specs = body.slack?.apps ?? [];
    const manifests: SlackManifest[] = [];
    for (const [index, spec] of specs.entries()) {
      const checked = validateManifest(spec.manifest);
      if ("problems" in checked) {
        const problem = checked.problems[0];
        return c.json(apiError("invalid_request", `slack.apps[${index}].manifest${problem?.pointer ?? ""}: ${problem?.message}`), 400);
      }
      manifests.push(checked.manifest);
    }
    const createdBy = caller.kind === "user" ? caller.user.id : null;
    const world = await createWorld(db, target.team.id, createdBy, body.name ?? "Untitled world");
    const apps = specs.length
      ? await c.env.SLACK.setupSlack(
          world.id,
          specs.map((spec, index) => ({ manifest: manifests[index] as SlackManifest, credentials: spec.credentials, install: spec.install })),
        )
      : [];
    const json = worldJson(world, c.env.WORLDS_DOMAIN);
    return c.json({ ...json, slack: { ...json.slack, apps } }, 201);
  })
  .openapi(getWorldRoute, async (c) => {
    const world = await visibleWorld(c, c.req.valid("param").worldId);
    if (!world) return c.json(apiError("not_found", NOT_VISIBLE), 404);
    return c.json(worldJson(world, c.env.WORLDS_DOMAIN), 200);
  })
  .openapi(deleteWorldRoute, async (c) => {
    const world = await visibleWorld(c, c.req.valid("param").worldId);
    if (!world) return c.json(apiError("not_found", NOT_VISIBLE), 404);
    await c.env.SLACK.purge(world.id);
    await markWorldDeleted(c.var.db, world.id);
    return c.body(null, 204);
  });

async function visibleWorld(c: { var: AppEnv["Variables"] }, worldId: string): Promise<World | null> {
  const world = await liveWorld(c.var.db, worldId);
  if (!world) return null;
  return (await accessibleTeam(c.var.db, c.var.caller, world.teamId)) ? world : null;
}
