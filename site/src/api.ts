import { membersOf, renameTeam, teamById, teamsForUser, useKey, type Db } from "./accounts";
import type { ApiKey, Membership, Team, User } from "./schema";

type Caller = { kind: "key"; key: ApiKey } | { kind: "user"; user: User };
type Role = Membership["role"];

const TEAM_PATH = /^\/api\/teams\/([\w-]+)$/;
export const TEAM_NAME_MAX = 80;

export async function handleApi(request: Request, url: URL, db: Db, sessionUser: User | null): Promise<Response> {
  const caller = await authenticate(request, db, sessionUser);
  if (!caller) return apiError(401, "unauthorized", "Send an API key as Authorization: Bearer <key>, or sign in.");
  if (caller.kind === "user" && request.method !== "GET" && request.headers.get("origin") !== url.origin) {
    return apiError(403, "forbidden", "Cross-site requests with a session are not allowed. Use an API key.");
  }

  if (url.pathname === "/api/teams") {
    if (request.method !== "GET") return methodNotAllowed(request, "GET");
    const teams = await accessibleTeams(db, caller);
    return Response.json({ teams: teams.map(({ team, role }) => teamJson(team, role)) });
  }

  const teamId = TEAM_PATH.exec(url.pathname)?.[1];
  if (teamId) {
    const access = (await accessibleTeams(db, caller)).find(({ team }) => team.id === teamId);
    if (!access) return apiError(404, "not_found", "No team with that id is visible to you.");
    if (request.method === "GET") return teamWithMembers(db, access.team, access.role);
    if (request.method === "PATCH") return updateTeam(request, db, caller, access.team, access.role);
    return methodNotAllowed(request, "GET, PATCH");
  }

  return apiError(404, "not_found", "No such endpoint.");
}

async function teamWithMembers(db: Db, team: Team, role: Role | null): Promise<Response> {
  const members = await membersOf(db, team.id);
  return Response.json({
    ...teamJson(team, role),
    members: members.map(({ user, role }) => ({ id: user.id, email: user.email, name: user.name, role })),
  });
}

async function updateTeam(request: Request, db: Db, caller: Caller, team: Team, role: Role | null): Promise<Response> {
  if (caller.kind === "key") return apiError(403, "forbidden", "API keys cannot change teams. Sign in as a team owner.");
  if (role !== "owner") return apiError(403, "forbidden", "Only team owners can change the team.");
  const body = await request.json().catch(() => null);
  const name = typeof body === "object" && body && "name" in body && typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > TEAM_NAME_MAX) {
    return apiError(400, "invalid_request", `name must be 1 to ${TEAM_NAME_MAX} characters.`);
  }
  await renameTeam(db, team.id, name);
  return Response.json(teamJson({ ...team, name }, role));
}

export function hasBearer(request: Request): boolean {
  return request.headers.get("authorization")?.startsWith("Bearer ") ?? false;
}

async function authenticate(request: Request, db: Db, sessionUser: User | null): Promise<Caller | null> {
  if (!hasBearer(request)) return sessionUser ? { kind: "user", user: sessionUser } : null;
  const key = await useKey(db, request.headers.get("authorization")?.slice("Bearer ".length).trim() ?? "");
  return key ? { kind: "key", key } : null;
}

async function accessibleTeams(db: Db, caller: Caller): Promise<{ team: Team; role: Role | null }[]> {
  if (caller.kind === "user") return teamsForUser(db, caller.user.id);
  const team = await teamById(db, caller.key.teamId);
  return team ? [{ team, role: null }] : [];
}

function teamJson(team: Team, role: Role | null) {
  return { id: team.id, name: team.name, role, created_at: team.createdAt.toISOString() };
}

function methodNotAllowed(request: Request, allow: string): Response {
  const response = apiError(405, "method_not_allowed", `${request.method} is not supported here.`);
  response.headers.set("allow", allow);
  return response;
}

function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
