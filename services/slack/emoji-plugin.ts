import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { Plugin } from "vite";

type EmojiData = {
  short_names: string[];
  unified: string;
  skin_variations?: Record<string, { unified: string }>;
};

const MODULE_ID = "virtual:slack-emoji";
const RESOLVED_ID = `\0${MODULE_ID}`;
const SKIN_TONES: Record<string, string> = {
  "1F3FB": "2",
  "1F3FC": "3",
  "1F3FD": "4",
  "1F3FE": "5",
  "1F3FF": "6",
};

function toText(unified: string): string {
  return String.fromCodePoint(...unified.split("-").map((code) => Number.parseInt(code, 16)));
}

function emojiByName(): Record<string, string> {
  const path = createRequire(import.meta.url).resolve("emoji-datasource/emoji.json");
  const data = JSON.parse(readFileSync(path, "utf8")) as EmojiData[];
  const byName: Record<string, string> = {};
  for (const emoji of data) {
    for (const name of emoji.short_names) {
      byName[name] = toText(emoji.unified);
      for (const [tones, variation] of Object.entries(emoji.skin_variations ?? {})) {
        const tone = SKIN_TONES[tones];
        if (tone) byName[`${name}::skin-tone-${tone}`] = toText(variation.unified);
      }
    }
  }
  return byName;
}

export function slackEmoji(): Plugin {
  return {
    name: "slack-emoji",
    resolveId: (id) => (id === MODULE_ID ? RESOLVED_ID : undefined),
    load: (id) =>
      id === RESOLVED_ID ? `export default ${JSON.stringify(emojiByName())};` : undefined,
  };
}
