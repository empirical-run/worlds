import { customAlphabet } from "nanoid";

const ID_PREFIXES = { user: "user", team: "team", apiKey: "key", world: "world" } as const;

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTHS: Record<IdKind, number> = { user: 20, team: 20, apiKey: 20, world: 10 };
const randomParts = Object.fromEntries(
  Object.entries(ID_LENGTHS).map(([kind, length]) => [kind, customAlphabet(ID_ALPHABET, length)]),
) as Record<IdKind, () => string>;
const secretPart = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 40);

export const API_KEY_SECRET_PREFIX = "wk_live_";

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomParts[kind]()}`;
}

export function newApiKeySecret(): string {
  return `${API_KEY_SECRET_PREFIX}${secretPart()}`;
}

const WORLD_ID_PREFIX = `${ID_PREFIXES.world}_`;

export function worldHost(worldId: string, service: string, domain: string): string {
  return `${worldId.slice(WORLD_ID_PREFIX.length)}-${service}.${domain}`;
}

export function parseWorldHost(hostname: string, domain: string): { worldId: string; service: string } | null {
  const match = new RegExp(`^([0-9a-z]+)-([a-z]+(?:-[a-z]+)*)\\.${domain.replaceAll(".", "\\.")}$`).exec(hostname);
  return match?.[1] && match[2] ? { worldId: `${WORLD_ID_PREFIX}${match[1]}`, service: match[2] } : null;
}
