import type { OAuthProvider } from "./providers";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_URL = "https://api.github.com";

type GitHubUser = { id: number; login: string; name: string | null; avatar_url: string };
type GitHubEmail = { email: string; primary: boolean; verified: boolean };

export const github: OAuthProvider = {
  authorizeUrl(env, redirectUri, state, challenge) {
    const params = new URLSearchParams({
      client_id: env.WORLDS_GITHUB_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      allow_signup: "true",
    });
    return `${AUTHORIZE_URL}?${params}`;
  },

  async exchangeCode(env, redirectUri, code, verifier) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.WORLDS_GITHUB_CLIENT_ID,
        client_secret: env.WORLDS_GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    const token = (await response.json()) as { access_token?: string; error?: string };
    if (!token.access_token) throw new Error(`github token exchange failed: ${response.status} ${token.error ?? ""}`);
    const [user, emails] = await Promise.all([
      githubApi<GitHubUser>(token.access_token, "/user"),
      githubApi<GitHubEmail[]>(token.access_token, "/user/emails"),
    ]);
    const email = emails.find((entry) => entry.primary && entry.verified)?.email;
    if (!email) throw new Error("github account has no verified primary email");
    return { provider: "github", subject: String(user.id), email, name: user.name ?? user.login, picture: user.avatar_url };
  },
};

async function githubApi<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "makeworlds.dev",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`github ${path} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}
