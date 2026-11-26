import {
  createKey,
  createSession,
  database,
  deleteSession,
  listKeys,
  revokeKey,
  SESSION_TTL_SECONDS,
  teamForUser,
  signIn,
  userForSession,
  type Db,
} from "./accounts";
import { handleApi, hasBearer } from "./api";
import { cookie, readCookie } from "./cookies";
import type { Env } from "./env";
import { randomToken, sha256 } from "./crypto";
import { callbackUrl, isProvider, providers } from "./providers";
import { accountPage, railUser, signInPage } from "./pages";
import type { Provider, Team, User } from "./schema";

const SESSION_COOKIE = "worlds_session";
const LOGIN_COOKIE = "worlds_login";
const LOGIN_TTL_SECONDS = 600;
const REVOKE_PATH = /^\/account\/keys\/([\w-]+)\/revoke$/;
const AUTH_PATH = /^\/auth\/([a-z]+)(\/callback)?$/;
const PROVIDER_NAMES: Record<Provider, string> = { google: "Google", github: "GitHub" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const db = database(env.DB);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleApi(request, url, db, hasBearer(request) ? null : await currentUser(request, db));
    }
    if (request.method === "POST" && !isSameOrigin(request, url)) return new Response("Forbidden", { status: 403 });

    if (url.pathname === "/auth/sign-out" && request.method === "POST") return signOut(request, url, db);
    const auth = request.method === "GET" ? AUTH_PATH.exec(url.pathname) : null;
    if (auth?.[1] && isProvider(auth[1])) {
      return auth[2] ? finishLogin(request, env, url, db, auth[1]) : startLogin(env, url, auth[1]);
    }

    if (url.pathname === "/account" || url.pathname.startsWith("/account/")) {
      const user = await currentUser(request, db);
      if (!user) return url.pathname === "/account" ? signInPage() : redirect("/account");
      const team = await teamForUser(db, user.id);
      if (url.pathname === "/account" && request.method === "GET") return accountPage(user, team, await listKeys(db, team.id));
      if (url.pathname === "/account/keys" && request.method === "POST") return createKeyFor(request, db, user, team);
      const revoke = request.method === "POST" ? REVOKE_PATH.exec(url.pathname) : null;
      if (revoke?.[1]) {
        await revokeKey(db, team.id, revoke[1]);
        return redirect("/account#keys");
      }
    }

    return withRailUser(request, await env.ASSETS.fetch(request), db);
  },
} satisfies ExportedHandler<Env>;

async function startLogin(env: Env, url: URL, provider: Provider): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken(48);
  const next = safeNext(url.searchParams.get("next"));
  const response = redirect(providers[provider].authorizeUrl(env, callbackUrl(url, provider), state, await sha256(verifier)));
  response.headers.append(
    "set-cookie",
    cookie(url, LOGIN_COOKIE, JSON.stringify({ provider, state, verifier, next }), { maxAge: LOGIN_TTL_SECONDS, path: "/auth" }),
  );
  return response;
}

async function finishLogin(request: Request, env: Env, url: URL, db: Db, provider: Provider): Promise<Response> {
  const login = parseLogin(readCookie(request, LOGIN_COOKIE));
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return signInPage(`${PROVIDER_NAMES[provider]} sign-in was cancelled.`);
  if (!login || !code || login.provider !== provider || url.searchParams.get("state") !== login.state) {
    return signInPage("Your sign-in link expired. Try again.");
  }
  const profile = await providers[provider].exchangeCode(env, callbackUrl(url, provider), code, login.verifier);
  const user = await signIn(db, profile);
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

async function createKeyFor(request: Request, db: Db, user: User, team: Team): Promise<Response> {
  const name = String((await request.formData()).get("name") ?? "").trim().slice(0, 80);
  if (!name) return redirect("/account#keys");
  const key = await createKey(db, team.id, user.id, name);
  return accountPage(user, team, await listKeys(db, team.id), key);
}

async function withRailUser(request: Request, response: Response, db: Db): Promise<Response> {
  if (!response.headers.get("content-type")?.startsWith("text/html")) return response;
  const user = await currentUser(request, db);
  if (!user) return response;
  const team = await teamForUser(db, user.id);
  const page = new HTMLRewriter()
    .on(".rail nav", {
      element: (nav) => {
        nav.after(railUser(user, team), { html: true });
      },
    })
    .transform(response);
  const headers = new Headers(page.headers);
  headers.set("cache-control", "private, no-store");
  headers.delete("etag");
  return new Response(page.body, { status: page.status, headers });
}

async function currentUser(request: Request, db: Db): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE);
  return token ? userForSession(db, token) : null;
}

type Login = { provider: string; state: string; verifier: string; next: string };

function parseLogin(value: string | null): Login | null {
  if (!value) return null;
  let login: Partial<Login>;
  try {
    login = JSON.parse(value);
  } catch {
    return null;
  }
  if (!login.provider || !login.state || !login.verifier) return null;
  return { provider: login.provider, state: login.state, verifier: login.verifier, next: safeNext(login.next ?? null) };
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
