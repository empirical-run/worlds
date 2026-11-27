import {
  database,
  SESSION_COOKIE,
  teamsForUser,
  useKey,
  userForSession,
  type World as WorldRecord,
} from "@worlds/db";

export async function canControl(
  request: Request,
  db: ReturnType<typeof database>,
  world: WorldRecord,
): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer wk_")) {
    const key = await useKey(db, authorization.slice("Bearer ".length).trim());
    return key?.teamId === world.teamId;
  }
  const session = readCookie(request, SESSION_COOKIE);
  const user = session ? await userForSession(db, session) : null;
  if (!user) return false;
  return (await teamsForUser(db, user.id)).some(({ team }) => team.id === world.teamId);
}

function readCookie(request: Request, name: string): string | null {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
