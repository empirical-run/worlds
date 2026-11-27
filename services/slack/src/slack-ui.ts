import type { createServer } from "@emulators/core";
import {
  getSlackStore,
  type SlackFile,
  type SlackMessage,
  type SlackStore,
} from "@emulators/slack";

type SlackServer = ReturnType<typeof createServer>;

const USER_SCOPES = [
  "chat:write",
  "channels:read",
  "channels:write",
  "channels:history",
  "groups:read",
  "groups:history",
  "users:read",
  "reactions:write",
  "reactions:read",
  "files:read",
  "files:write",
];

export const ACTING_METHODS = new Set([
  "chat.postMessage",
  "conversations.create",
  "conversations.invite",
  "reactions.add",
  "reactions.remove",
]);

const VISIBLE_SUBTYPES = new Set(["file_share", "bot_message", "thread_broadcast", "me_message"]);

export type UiFile = { id: string; name: string; mimetype: string; size: number };

export type UiImage = { file_id?: string; url?: string; alt: string };

export type UiMessage = {
  ts: string;
  thread_ts?: string;
  user: string;
  text: string;
  reply_count: number;
  reply_users: string[];
  reactions: SlackMessage["reactions"];
  bot_name?: string;
  edited: boolean;
  files: UiFile[];
  images: UiImage[];
};

function toUiFile(file: Pick<SlackFile, "file_id" | "name" | "mimetype" | "size">): UiFile {
  return { id: file.file_id, name: file.name, mimetype: file.mimetype, size: file.size };
}

function blockImages(blocks: SlackMessage["blocks"]): UiImage[] {
  return (blocks ?? []).flatMap((block): UiImage[] => {
    if (block.type !== "image") return [];
    const slackFile = block.slack_file as { id?: string; url?: string } | undefined;
    const alt = typeof block.alt_text === "string" ? block.alt_text : "";
    if (slackFile?.id) return [{ file_id: slackFile.id, alt }];
    const url = typeof block.image_url === "string" ? block.image_url : slackFile?.url;
    return url ? [{ url, alt }] : [];
  });
}

function toUiMessage(message: SlackMessage): UiMessage {
  return {
    ts: message.ts,
    thread_ts: message.thread_ts,
    user: message.user,
    text: message.text,
    reply_count: message.reply_count ?? 0,
    reply_users: message.reply_users ?? [],
    reactions: message.reactions ?? [],
    bot_name: message.bot_profile?.name ?? message.username,
    edited: Boolean(message.edited),
    files: (message.files ?? []).map(toUiFile),
    images: blockImages(message.blocks),
  };
}

export function worldState(slack: SlackServer, channelId: string | null) {
  const store = getSlackStore(slack.store);
  const team = store.teams.all()[0];
  const users = store.users
    .all()
    .filter((user) => !user.deleted)
    .map((user) => ({
      id: user.user_id,
      name: user.name,
      real_name: user.real_name || user.profile.real_name || user.name,
      is_bot: user.is_bot,
      has_token: store.tokens
        .all()
        .some((token) => token.token_type === "user" && token.user_id === user.user_id),
    }));
  const channels = store.channels
    .all()
    .filter((channel) => !channel.is_archived && !channel.is_im && !channel.is_mpim)
    .map((channel) => ({
      id: channel.channel_id,
      name: channel.name,
      is_private: channel.is_private,
      topic: channel.topic?.value ?? "",
      members: channel.members ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const messages = channelId
    ? store.messages
        .all()
        .filter(
          (message) =>
            message.channel_id === channelId &&
            (!message.subtype || VISIBLE_SUBTYPES.has(message.subtype)),
        )
        .sort((a, b) => Number(a.ts) - Number(b.ts))
        .map(toUiMessage)
    : [];
  return { team: team ? { id: team.team_id, name: team.name } : null, users, channels, messages };
}

export function userToken(slack: SlackServer, userId: string): string | null {
  const store = getSlackStore(slack.store);
  const user = store.users.findOneBy("user_id", userId);
  if (!user || user.is_bot || user.deleted) return null;
  const existing = store.tokens
    .all()
    .find((token) => token.token_type === "user" && token.user_id === userId);
  if (existing) return existing.token;
  const token = `xoxp-worlds-${crypto.randomUUID()}`;
  store.tokens.insert({
    token,
    token_type: "user",
    team_id: user.team_id,
    user_id: userId,
    scopes: USER_SCOPES,
  });
  return token;
}

export function fileContent(store: SlackStore, fileId: string): Response | null {
  const file = store.files.findOneBy("file_id", fileId);
  if (!file || file.deleted) return null;
  const bytes = Uint8Array.from(atob(file.content_base64 ?? ""), (char) => char.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "content-type": file.mimetype || "application/octet-stream",
      "cache-control": "private, max-age=3600",
    },
  });
}
