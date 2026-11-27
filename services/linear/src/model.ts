import type { IssueState, LinearState } from "./spec";

export type Comment = { id: string; user: string; body: string; created: number; updated: number };

export type Reaction = { id: string; user: string; emoji: string; created: number };

export type Attachment = {
  id: string;
  creator: string;
  title: string;
  subtitle: string | null;
  url: string;
  icon_url: string | null;
  metadata: Record<string, unknown>;
  created: number;
  updated: number;
};

export type Issue = {
  id: string;
  identifier: string;
  number: number;
  team: string;
  title: string;
  description: string | null;
  state: IssueState;
  creator: string;
  assignee: string | null;
  created: number;
  updated: number;
  comments: Comment[];
  reactions: Reaction[];
  attachments: Attachment[];
};

export type AppUser = {
  id: string;
  client_id: string;
  name: string;
  handle: string;
  email: string;
  scopes: string[];
  active: boolean;
  created: number;
};

export type Grant = { client_id: string; user_id: string; scopes: string[]; actor: "user" | "app" };

export type AuthCode = Grant & { code: string; redirect_uri: string; expires_at: number };

export type AccessToken = Grant & { token: string; grant_id: string; expires_at: number };

export type TokenPair = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token: string;
};

export type RefreshToken = Grant & {
  token: string;
  grant_id: string;
  expires_at: number;
  rotated_at: number | null;
  replacement: TokenPair | null;
};

export type LinearData = {
  state: LinearState;
  issues: Issue[];
  app_users: AppUser[];
  sync_id: number;
  codes: AuthCode[];
  access_tokens: AccessToken[];
  refresh_tokens: RefreshToken[];
};

export type Origins = { app: string; api: string };

export type Person = {
  id: string;
  name: string;
  handle: string;
  email: string;
  app: boolean;
  created: number;
};

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "issue"
  );
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

export function randomToken(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function stableUuid(seed: string): string {
  let hex = "";
  let hash = 0x811c9dc5;
  for (let round = 0; hex.length < 32; round++) {
    for (const char of `${seed}:${round}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hex += hash.toString(16).padStart(8, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
