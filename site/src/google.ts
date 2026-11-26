import { randomToken, sha256 } from "./crypto";
import type { Env } from "./env";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export type GoogleProfile = { sub: string; email: string; name: string | null; picture: string | null };

export function callbackUrl(url: URL): string {
  return `${url.origin}/auth/google/callback`;
}

export async function authorizeUrl(env: Env, url: URL, state: string, verifier: string): Promise<string> {
  const challenge = await sha256(verifier);
  const params = new URLSearchParams({
    client_id: env.WORLDS_GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(url),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export function newVerifier(): string {
  return randomToken(48);
}

export async function exchangeCode(env: Env, url: URL, code: string, verifier: string): Promise<GoogleProfile> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.WORLDS_GOOGLE_CLIENT_ID,
      client_secret: env.WORLDS_GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(url),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`google token exchange failed: ${response.status} ${await response.text()}`);
  const { id_token: idToken } = (await response.json()) as { id_token?: string };
  if (!idToken) throw new Error("google token response has no id_token");
  return profileFromIdToken(env, idToken);
}

// OIDC Core 3.1.3.7: an id_token received directly from the token endpoint over TLS needs no signature check.
function profileFromIdToken(env: Env, idToken: string): GoogleProfile {
  const claims = JSON.parse(new TextDecoder().decode(decodeBase64url(idToken.split(".")[1] ?? ""))) as {
    iss: string;
    aud: string;
    exp: number;
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!ISSUERS.has(claims.iss)) throw new Error(`unexpected id_token issuer ${claims.iss}`);
  if (claims.aud !== env.WORLDS_GOOGLE_CLIENT_ID) throw new Error("id_token audience mismatch");
  if (claims.exp * 1000 < Date.now()) throw new Error("id_token expired");
  if (!claims.email || !claims.email_verified) throw new Error("google account email is not verified");
  return { sub: claims.sub, email: claims.email, name: claims.name ?? null, picture: claims.picture ?? null };
}

function decodeBase64url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
