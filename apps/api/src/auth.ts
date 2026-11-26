import { database, SESSION_COOKIE, useKey, userForSession } from "@worlds/db";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { apiError, type AppEnv, type Caller } from "./context";

const PUBLIC_PATHS = new Set(["/api/openapi.json"]);

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = database(c.env.DB);
  c.set("db", db);
  if (PUBLIC_PATHS.has(c.req.path)) return next();

  const caller = await callerFor(c.req.header("authorization"), getCookie(c, SESSION_COOKIE), db);
  if (!caller) return c.json(apiError("unauthorized", "Send an API key as Authorization: Bearer <key>, or sign in."), 401);
  if (caller.kind === "user" && c.req.method !== "GET" && c.req.header("origin") !== new URL(c.req.url).origin) {
    return c.json(apiError("forbidden", "Cross-site requests with a session are not allowed. Use an API key."), 403);
  }
  c.set("caller", caller);
  return next();
};

async function callerFor(authorization: string | undefined, session: string | undefined, db: ReturnType<typeof database>): Promise<Caller | null> {
  if (authorization?.startsWith("Bearer ")) {
    const key = await useKey(db, authorization.slice("Bearer ".length).trim());
    return key ? { kind: "key", key } : null;
  }
  if (!session) return null;
  const user = await userForSession(db, session);
  return user ? { kind: "user", user } : null;
}
