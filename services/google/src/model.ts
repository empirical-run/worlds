import type { GoogleState, ShareRole } from "./spec";

export type Share = { user: string; role: ShareRole };

export type FileRecord = {
  id: string;
  name: string;
  mime_type: string;
  description: string;
  owner: string;
  parent: string;
  trashed: boolean;
  shares: Share[];
  size: number | null;
  md5: string | null;
  version: number;
  created: number;
  modified: number;
};

export type Grant = { client_id: string; user_id: string; file_id: string };

export type AuthCode = {
  code: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  redirect_uri: string;
  offline: boolean;
  expires_at: number;
};

export type AccessToken = {
  token: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  offline: boolean;
  refresh_token: string | null;
  expires_at: number;
};

export type RefreshToken = {
  token: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  expires_at: number;
};

export type GoogleData = {
  state: GoogleState;
  files: FileRecord[];
  grants: Grant[];
  codes: AuthCode[];
  access_tokens: AccessToken[];
  refresh_tokens: RefreshToken[];
};

export type Origins = { accounts: string; api: string };

export type Role = "owner" | ShareRole;

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function randomId(length: number, alphabet = ID_ALPHABET): string {
  return [...crypto.getRandomValues(new Uint8Array(length))]
    .map((byte) => alphabet[byte % alphabet.length])
    .join("");
}

export function newFileId(): string {
  return `1${randomId(32)}`;
}

export function newRootId(): string {
  return `0A${randomId(17, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-")}PVA`;
}

export function digits(length: number): string {
  return randomId(length, "0123456789").replace(/^0/, "1");
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

export async function md5Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("MD5", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
