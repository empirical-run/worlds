import {
  createKey,
  createSession,
  database,
  deleteSession,
  listKeys,
  revokeKey,
  SESSION_TTL_SECONDS,
  upsertUser,
  userForSession,
  type Db,
} from "./accounts";
import { cookie, readCookie } from "./cookies";
import type { Env } from "./env";
import { authorizeUrl, exchangeCode, newVerifier } from "./google";
import { randomToken } from "./crypto";
import { accountPage, signInPage } from "./pages";
import type { User } from "./schema";

const SESSION_COOKIE = "worlds_session";
const LOGIN_COOKIE = "worlds_login";
const LOGIN_TTL_SECONDS = 600;
const REVOKE_PATH = /^\/account\/keys\/([\w-]+)\/revoke$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const db = database(env.DB);
    if (request.method === "POST" && !isSameOrigin(request, url)) return new Response("Forbidden", { status: 403 });

    if (url.pathname === "/auth/google" && request.method === "GET") return startLogin(env, url);
    if (url.pathname === "/auth/google/callback" && request.method === "GET") return finishLogin(request, env, url, db);
    if (url.pathname === "/auth/sign-out" && request.method === "POST") return signOut(request, url, db);

    if (url.pathname === "/account" || url.pathname.startsWith("/account/")) {
      const user = await currentUser(request, db);
      if (!user) return url.pathname === "/account" ? signInPage() : redirect("/account");
      if (url.pathname === "/account" && request.method === "GET") return accountPage(user, await listKeys(db, user.id));
      if (url.pathname === "/account/keys" && request.method === "POST") return createKeyFor(request, db, user);
      const revoke = request.method === "POST" ? REVOKE_PATH.exec(url.pathname) : null;
      if (revoke?.[1]) {
        await revokeKey(db, user.id, revoke[1]);
        return redirect("/account#keys");
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function startLogin(env: Env, url: URL): Promise<Response> {
  const state = randomToken();
  const verifier = newVerifier();
  const next = safeNext(url.searchParams.get("next"));
  const response = redirect(await authorizeUrl(env, url, state, verifier));
  response.headers.append(
    "set-cookie",
    cookie(url, LOGIN_COOKIE, JSON.stringify({ state, verifier, next }), { maxAge: LOGIN_TTL_SECONDS, path: "/auth" }),
  );
  return response;
}

async function finishLogin(request: Request, env: Env, url: URL, db: Db): Promise<Response> {
  const login = parseLogin(readCookie(request, LOGIN_COOKIE));
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return signInPage("Google sign-in was cancelled.");
  if (!login || !code || url.searchParams.get("state") !== login.state) {
    return signInPage("Your sign-in link expired. Try again.");
  }
  const profile = await exchangeCode(env, url, code, login.verifier);
  const user = await upsertUser(db, profile);
  const token = await createSession(db, user.id);
  const response = redirect(login.next);
  response.headers.append(
    "set-cookie",
    cookie(url, SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, sharedAcrossSubdomains: true }),
  );
  response.headers.append("set-cookie", cookie(url, LOGIN_COOKIE, "", { maxAge: 0, path: "/auth" }));
  return response;
}

async function signOut(request: Request, url: URL, db: Db): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await deleteSession(db, token);
  const response = redirect("/");
  response.headers.append("set-cookie", cookie(url, SESSION_COOKIE, "", { maxAge: 0, sharedAcrossSubdomains: true }));
  return response;
}

async function createKeyFor(request: Request, db: Db, user: User): Promise<Response> {
  const name = String((await request.formData()).get("name") ?? "").trim().slice(0, 80);
  if (!name) return redirect("/account#keys");
  const key = await createKey(db, user.id, name);
  return accountPage(user, await listKeys(db, user.id), key);
}

async function currentUser(request: Request, db: Db): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE);
  return token ? userForSession(db, token) : null;
}

function parseLogin(value: string | null): { state: string; verifier: string; next: string } | null {
  if (!value) return null;
  let login: Partial<{ state: string; verifier: string; next: string }>;
  try {
    login = JSON.parse(value);
  } catch {
    return null;
  }
  if (!login.state || !login.verifier) return null;
  return { state: login.state, verifier: login.verifier, next: safeNext(login.next ?? null) };
}

function safeNext(next: string | null): string {
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

function isSameOrigin(request: Request, url: URL): boolean {
  return request.headers.get("origin") === url.origin;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
