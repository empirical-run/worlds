import { customAlphabet } from "nanoid";

const ID_PREFIXES = { user: "user", team: "team", apiKey: "key" } as const;

const randomPart = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 20);

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomPart()}`;
}
