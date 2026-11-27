import { customAlphabet } from "nanoid";

const ID_PREFIXES = { user: "user", team: "team", apiKey: "key" } as const;

const randomPart = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 20);
const secretPart = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 40);

export const API_KEY_SECRET_PREFIX = "wk_live_";

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomPart()}`;
}

export function newApiKeySecret(): string {
  return `${API_KEY_SECRET_PREFIX}${secretPart()}`;
}
