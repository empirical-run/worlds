import {
  createSession,
  deleteSession,
  randomToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sha256,
  signIn,
  teamForUser,
  userForSession,
  type Db,
  type Provider,
} from "@worlds/db";
import type { Account } from "./context";
import { cookie, readCookie } from "./cookies";
import type { Env } from "./env";
import { callbackUrl, isProvider, providers } from "./providers";

const LOGIN_COOKIE = "worlds_login";
const LOGIN_TTL_SECONDS = 600;
const AUTH_PATH = /^\/auth\/([a-z]+)(\/callback)?$/;

type Login = { provider: string; state: string; verifier: string; next: string };

export async function handleAuth(request: Request, env: Env, url: URL, db: Db): Promise<Response | null> {
  if (url.pathname === "/auth/sign-out" && request.method === "POST") {
    if (request.headers.get("origin") !== url.origin) return new Response("Forbidden", { status: 403 });
    return signOut(request, url, db);
  }
  const match = request.method === "GET" ? AUTH_PATH.exec(url.pathname) : null;
  if (!match?.[1] || !isProvider(match[1])) return null;
  return match[2] ? finishLogin(request, env, url, db, match[1]) : startLogin(env, url, match[1]);
}

export async function accountFor(request: Request, db: Db): Promise<Account | null> {
  const token = readCookie(request, SESSION_COOKIE);
  const user = token ? await userForSession(db, token) : null;
  if (!user) return null;
  const { team, role } = await teamForUser(db, user.id);
  return { user, team, role };
}

async function startLogin(env: Env, url: URL, provider: Provider): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken(48);
  const next = safeNext(url.searchParams.get("next"));
  const response = redirect(providers[provider].authorizeUrl(env, callbackUrl(url, provider), state, await sha256(verifier)));
  const login: Login = { provider, state, verifier, next };
  response.headers.append("set-cookie", cookie(url, LOGIN_COOKIE, JSON.stringify(login), { maxAge: LOGIN_TTL_SECONDS, path: "/auth" }));
  return response;
}

async function finishLogin(request: Request, env: Env, url: URL, db: Db, provider: Provider): Promise<Response> {
  const login = parseLogin(readCookie(request, LOGIN_COOKIE));
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return redirect(`/account?sign_in=cancelled&provider=${provider}`);
  if (!login || !code || login.provider !== provider || url.searchParams.get("state") !== login.state) {
    return redirect("/account?sign_in=expired");
  }
  const profile = await providers[provider].exchangeCode(env, callbackUrl(url, provider), code, login.verifier);
  const user = await signIn(db, profile);
  const token = await createSession(db, user.id);
  const response = redirect(login.next);
  response.headers.append("set-cookie", cookie(url, SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, sharedAcrossSubdomains: true }));
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
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/worlds";
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
