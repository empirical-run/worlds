import type { ReactNode } from "react";

import { Emoji, emojiFor } from "./emoji";

export type Lookup = { userName: (id: string) => string; channelName: (id: string) => string };

const INLINE =
  /(:[a-z0-9_+'-]+(?:::skin-tone-[2-6])?:)|(`[^`\n]+`)|(<[^>\n]+>)|((?<![\w*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\w*]))|((?<![\w_])_(?!\s)[^_\n]+?(?<!\s)_(?![\w_]))|((?<![\w~])~(?!\s)[^~\n]+?(?<!\s)~(?![\w~]))/g;

function decode(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function angle(token: string, lookup: Lookup, key: string): ReactNode {
  const [target, label] = token.slice(1, -1).split("|", 2);
  if (target.startsWith("@")) {
    return (
      <span key={key} className="mention">
        @{label ?? lookup.userName(target.slice(1))}
      </span>
    );
  }
  if (target.startsWith("#")) {
    return (
      <span key={key} className="mention">
        #{label ?? lookup.channelName(target.slice(1))}
      </span>
    );
  }
  if (target.startsWith("!")) {
    return (
      <span key={key} className="mention">
        @{label ?? target.slice(1).split("^")[0]}
      </span>
    );
  }
  return (
    <a key={key} href={decode(target)} target="_blank" rel="noreferrer">
      {decode(label ?? target)}
    </a>
  );
}

function inline(text: string, lookup: Lookup, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) {
      nodes.push(decode(text.slice(last, index)));
    }
    const token = match[0];
    const key = `${prefix}-${index}`;
    const inner = token.slice(1, -1);
    if (match[1]) {
      nodes.push(emojiFor(inner) ? <Emoji key={key} name={inner} /> : token);
    } else if (match[2]) {
      nodes.push(<code key={key}>{decode(inner)}</code>);
    } else if (match[3]) {
      nodes.push(angle(token, lookup, key));
    } else if (match[4]) {
      nodes.push(<strong key={key}>{inline(inner, lookup, key)}</strong>);
    } else if (match[5]) {
      nodes.push(<em key={key}>{inline(inner, lookup, key)}</em>);
    } else {
      nodes.push(<s key={key}>{inline(inner, lookup, key)}</s>);
    }
    last = index + token.length;
  }
  if (last < text.length) {
    nodes.push(decode(text.slice(last)));
  }
  return nodes;
}

function trimAroundCode(part: string, index: number, count: number): string {
  const start = index > 0 ? part.replace(/^\n/, "") : part;
  return index < count - 1 ? start.replace(/\n$/, "") : start;
}

export function Mrkdwn({ text, lookup }: { text: string; lookup: Lookup }) {
  const parts = text.split("```");
  return (
    <div className="mrkdwn">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <pre key={index}>{decode(part.replace(/^\n/, ""))}</pre>
        ) : (
          <span key={index}>
            {inline(trimAroundCode(part, index, parts.length), lookup, String(index))}
          </span>
        ),
      )}
    </div>
  );
}
