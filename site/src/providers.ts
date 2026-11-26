import type { Env } from "./env";
import { github } from "./github";
import { google } from "./google";
import type { Provider } from "./schema";

export type Profile = {
  provider: Provider;
  subject: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export type OAuthProvider = {
  authorizeUrl(env: Env, redirectUri: string, state: string, challenge: string): string;
  exchangeCode(env: Env, redirectUri: string, code: string, verifier: string): Promise<Profile>;
};

export const providers: Record<Provider, OAuthProvider> = { google, github };

export function isProvider(value: string): value is Provider {
  return Object.hasOwn(providers, value);
}

export function callbackUrl(url: URL, provider: Provider): string {
  return `${url.origin}/auth/${provider}/callback`;
}
