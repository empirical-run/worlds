import { teamById, teamsForUser, type Db } from "@worlds/db";
import type { Caller, TeamAccess } from "./context";

export async function accessibleTeams(db: Db, caller: Caller): Promise<TeamAccess[]> {
  if (caller.kind === "user") return teamsForUser(db, caller.user.id);
  const team = await teamById(db, caller.key.teamId);
  return team ? [{ team, role: null }] : [];
}

export async function accessibleTeam(db: Db, caller: Caller, teamId: string): Promise<TeamAccess | null> {
  return (await accessibleTeams(db, caller)).find(({ team }) => team.id === teamId) ?? null;
}

export function teamJson({ team, role }: TeamAccess) {
  return { id: team.id, name: team.name, role, created_at: team.createdAt.toISOString() };
}
