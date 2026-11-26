import { membersOf, teamById, teamsForUser, useKey, type Db } from "./accounts";
import type { ApiKey, Membership, Team, User } from "./schema";

type Caller = { kind: "key"; key: ApiKey } | { kind: "user"; user: User };
type Role = Membership["role"];

const TEAM_PATH = /^\/api\/teams\/([\w-]+)$/;

export async function handleApi(request: Request, url: URL, db: Db, sessionUser: User | null): Promise<Response> {
  const caller = await authenticate(request, db, sessionUser);
  if (!caller) return apiError(401, "unauthorized", "Send an API key as Authorization: Bearer <key>, or sign in.");
  if (request.method !== "GET") return apiError(405, "method_not_allowed", `${request.method} is not supported here.`);

  if (url.pathname === "/api/teams") {
    const teams = await accessibleTeams(db, caller);
    return Response.json({ teams: teams.map(({ team, role }) => teamJson(team, role)) });
  }

  const teamId = TEAM_PATH.exec(url.pathname)?.[1];
  if (teamId) {
    const access = (await accessibleTeams(db, caller)).find(({ team }) => team.id === teamId);
    if (!access) return apiError(404, "not_found", "No team with that id is visible to you.");
    const members = await membersOf(db, teamId);
    return Response.json({
      ...teamJson(access.team, access.role),
      members: members.map(({ user, role }) => ({ id: user.id, email: user.email, name: user.name, role })),
    });
  }

  return apiError(404, "not_found", "No such endpoint.");
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

function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
