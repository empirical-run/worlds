import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { apiError, errorResponse, jsonResponse, security } from "@worlds/contract";
import {
  archiveWorld,
  createWorld,
  listWorlds,
  liveWorld,
  worldHost,
  type World,
} from "@worlds/db";
import {
  serviceTitles,
  specifiedServices,
  specProblems,
  withSpecs,
  worldServices,
  worldUrls,
} from "@worlds/services";

import type { AppEnv } from "../context";
import {
  WorldCreatedSchema,
  WorldCreateSchema,
  WorldListSchema,
  WorldParamsSchema,
  WorldSchema,
  WorldSpecSchema,
} from "../schemas";
import { accessibleTeam, accessibleTeams } from "../teams";

const listWorldsRoute = createRoute({
  method: "get",
  path: "/api/worlds",
  tags: ["Worlds"],
  summary: "List worlds",
  description: "Worlds in the teams you can see, newest first. Archived worlds are not listed.",
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
  description: `A new world with a spec for each service it should have (${serviceTitles("and")}). Point your app at the returned URLs.`,
  security,
  request: {
    body: { required: true, content: { "application/json": { schema: WorldCreateSchema } } },
  },
  responses: {
    201: jsonResponse(
      "The new world, with each service's effective spec (generated ids, credentials and tokens filled in)",
      WorldCreatedSchema,
    ),
    400: errorResponse(`Invalid name, no service spec, or an invalid ${serviceTitles("or")} spec`),
    401: errorResponse("Missing or invalid credentials"),
    404: errorResponse("You are not in any team"),
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

const getWorldSpecRoute = createRoute({
  method: "get",
  path: "/api/worlds/{worldId}/spec",
  tags: ["Worlds"],
  summary: "Get a world's spec",
  description:
    "The spec the world was created from, with generated ids, credentials and tokens filled in. Create a world from it to get an identical one.",
  security,
  request: { params: WorldParamsSchema },
  responses: {
    200: jsonResponse("The world's spec", WorldSpecSchema),
    401: errorResponse("Missing or invalid credentials"),
    404: errorResponse("No world with that id is visible to you, or it predates world specs"),
  },
});

const archiveWorldRoute = createRoute({
  method: "post",
  path: "/api/worlds/{worldId}/archive",
  tags: ["Worlds"],
  summary: "Archive a world",
  description:
    "Takes the world offline for good: it leaves the list, its URLs stop working and pending event deliveries are dropped. Archiving cannot be undone.",
  security,
  request: { params: WorldParamsSchema },
  responses: {
    204: { description: "Archived" },
    401: errorResponse("Missing or invalid credentials"),
    404: errorResponse("No world with that id is visible to you"),
  },
});

function worldJson(world: World, domain: string) {
  const services = worldServices(origins(world, domain), world.services);
  const [mainUi] = services;
  if (!mainUi) throw new Error(`world ${world.id} has no services`);
  return {
    id: world.id,
    name: world.name,
    team_id: world.teamId,
    created_by: world.createdBy,
    ui_url: mainUi.ui_url,
    services,
    ...worldUrls(origins(world, domain), world.services),
    created_at: world.createdAt.toISOString(),
    updated_at: world.updatedAt.toISOString(),
  };
}

function origins(world: World, domain: string) {
  return (host: string) => `https://${worldHost(world.id, host, domain)}`;
}

const NOT_VISIBLE = "No world with that id is visible to you.";

const NO_SERVICE = `A world needs a ${serviceTitles("or")} spec.`;

export const worlds = new OpenAPIHono<AppEnv>()
  .openapi(listWorldsRoute, async (c) => {
    const teams = await accessibleTeams(c.var.db, c.var.caller);
    const found = await listWorlds(
      c.var.db,
      teams.map(({ team }) => team.id),
    );
    return c.json({ worlds: found.map((world) => worldJson(world, c.env.WORLDS_DOMAIN)) }, 200);
  })
  .openapi(createWorldRoute, async (c) => {
    const { caller, db } = c.var;
    const body = c.req.valid("json");
    const [target] = await accessibleTeams(db, caller);
    if (!target) return c.json(apiError("not_found", "You are not in any team."), 404);
    const { name, ...specs } = body;
    const services = specifiedServices(specs);
    if (!services.length) return c.json(apiError("invalid_request", NO_SERVICE), 400);
    const problem = specProblems(specs)[0];
    if (problem) return c.json(apiError("invalid_request", problem), 400);
    const createdBy = caller.kind === "user" ? caller.user.id : null;
    const world = await createWorld(
      db,
      target.team.id,
      createdBy,
      name ?? "Untitled world",
      services,
    );
    const states = await c.env.WORLDS.setup(world.id, specs);
    const urls = worldUrls(origins(world, c.env.WORLDS_DOMAIN), world.services);
    return c.json({ ...worldJson(world, c.env.WORLDS_DOMAIN), ...withSpecs(urls, states) }, 201);
  })
  .openapi(getWorldRoute, async (c) => {
    const world = await visibleWorld(c, c.req.valid("param").worldId);
    if (!world) return c.json(apiError("not_found", NOT_VISIBLE), 404);
    return c.json(worldJson(world, c.env.WORLDS_DOMAIN), 200);
  })
  .openapi(getWorldSpecRoute, async (c) => {
    const world = await visibleWorld(c, c.req.valid("param").worldId);
    const states = world ? await c.env.WORLDS.states(world.id) : null;
    if (!states || Object.values(states).every((state) => state === null))
      return c.json(apiError("not_found", NOT_VISIBLE), 404);
    return c.json(states, 200);
  })
  .openapi(archiveWorldRoute, async (c) => {
    const world = await visibleWorld(c, c.req.valid("param").worldId);
    if (!world) return c.json(apiError("not_found", NOT_VISIBLE), 404);
    await archiveWorld(c.var.db, world.id);
    await c.env.WORLDS.archive(world.id);
    return c.body(null, 204);
  });

async function visibleWorld(
  c: { var: AppEnv["Variables"] },
  worldId: string,
): Promise<World | null> {
  const world = await liveWorld(c.var.db, worldId);
  if (!world) return null;
  return (await accessibleTeam(c.var.db, c.var.caller, world.teamId)) ? world : null;
}
