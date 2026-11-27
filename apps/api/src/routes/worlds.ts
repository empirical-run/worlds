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
import { DEFAULT_JIRA_SPEC, jiraSpecProblems, type JiraSpec } from "@worlds/jira/spec";
import { validateManifest } from "@worlds/slack/manifest";
import { DEFAULT_SLACK_SPEC, unknownReferences, type SlackSpec } from "@worlds/slack/spec";

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
  description:
    "A new world with a seeded Slack workspace and Jira site. Point your app at the returned URLs.",
  security,
  request: {
    body: { required: false, content: { "application/json": { schema: WorldCreateSchema } } },
  },
  responses: {
    201: jsonResponse(
      "The new world, with its effective Slack and Jira specs (generated ids, credentials and tokens filled in)",
      WorldCreatedSchema,
    ),
    400: errorResponse("Invalid name, Slack spec or Jira spec"),
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
  const base = `https://${worldHost(world.id, "slack", domain)}`;
  const jiraOrigin = (service: string) => `https://${worldHost(world.id, service, domain)}`;
  return {
    id: world.id,
    name: world.name,
    team_id: world.teamId,
    created_by: world.createdBy,
    slack: {
      api_url: `${base}/api/`,
      oauth_authorize_url: `${base}/oauth/v2/authorize`,
      ui_url: `${base}/`,
    },
    jira: {
      site_url: jiraOrigin("jira"),
      auth_url: jiraOrigin("jira-auth"),
      api_url: jiraOrigin("jira-api"),
    },
    created_at: world.createdAt.toISOString(),
    updated_at: world.updatedAt.toISOString(),
  };
}

const NOT_VISIBLE = "No world with that id is visible to you.";

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
    const body = c.req.valid("json") ?? {};
    const [target] = await accessibleTeams(db, caller);
    if (!target) return c.json(apiError("not_found", "You are not in any team."), 404);
    const problem = slackSpecProblem(body.slack);
    if (problem) return c.json(apiError("invalid_request", problem), 400);
    const jiraProblem = body.jira ? jiraSpecProblems(body.jira as JiraSpec)[0] : undefined;
    if (jiraProblem) return c.json(apiError("invalid_request", `jira.${jiraProblem}`), 400);
    const createdBy = caller.kind === "user" ? caller.user.id : null;
    const world = await createWorld(db, target.team.id, createdBy, body.name ?? "Untitled world");
    const spec = await c.env.SLACK.setupSlack(
      world.id,
      (body.slack as SlackSpec | undefined) ?? DEFAULT_SLACK_SPEC,
    );
    const jira = await c.env.SLACK.setupJira(
      world.id,
      (body.jira as JiraSpec | undefined) ?? DEFAULT_JIRA_SPEC,
    );
    const json = worldJson(world, c.env.WORLDS_DOMAIN);
    return c.json(
      { ...json, slack: { ...json.slack, spec }, jira: { ...json.jira, spec: jira } },
      201,
    );
  })
  .openapi(getWorldRoute, async (c) => {
    const world = await visibleWorld(c, c.req.valid("param").worldId);
    if (!world) return c.json(apiError("not_found", NOT_VISIBLE), 404);
    return c.json(worldJson(world, c.env.WORLDS_DOMAIN), 200);
  })
  .openapi(getWorldSpecRoute, async (c) => {
    const world = await visibleWorld(c, c.req.valid("param").worldId);
    const spec = world ? await c.env.SLACK.slackState(world.id) : null;
    if (!world || !spec) return c.json(apiError("not_found", NOT_VISIBLE), 404);
    return c.json({ slack: spec, jira: await c.env.SLACK.jiraState(world.id) }, 200);
  })
  .openapi(archiveWorldRoute, async (c) => {
    const world = await visibleWorld(c, c.req.valid("param").worldId);
    if (!world) return c.json(apiError("not_found", NOT_VISIBLE), 404);
    await archiveWorld(c.var.db, world.id);
    await c.env.SLACK.archive(world.id);
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

function slackSpecProblem(
  spec:
    | {
        users?: { name: string }[];
        channels?: { name: string }[];
        apps?: { manifest: unknown; credentials?: { client_id?: string } }[];
      }
    | undefined,
): string | null {
  if (!spec) return null;
  for (const [index, app] of (spec.apps ?? []).entries()) {
    const checked = validateManifest(app.manifest);
    if ("problems" in checked)
      return `slack.apps[${index}].manifest${checked.problems[0]?.pointer ?? ""}: ${checked.problems[0]?.message}`;
  }
  const duplicate = (values: string[]) =>
    values.find((value, index) => values.indexOf(value) !== index);
  const user = duplicate((spec.users ?? []).map((entry) => entry.name));
  if (user) return `slack.users: duplicate name ${user}`;
  const channel = duplicate((spec.channels ?? []).map((entry) => entry.name));
  if (channel) return `slack.channels: duplicate name ${channel}`;
  const clientId = duplicate(
    (spec.apps ?? []).flatMap((app) =>
      app.credentials?.client_id ? [app.credentials.client_id] : [],
    ),
  );
  if (clientId) return `slack.apps: duplicate client_id ${clientId}`;
  const unknown = unknownReferences(spec as SlackSpec)[0];
  return unknown ? `slack.${unknown}` : null;
}
