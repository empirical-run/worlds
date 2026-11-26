import type { createServer } from "@emulators/core";
import { getSlackStore, type SlackMessage } from "@emulators/slack";

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
];

export const ACTING_METHODS = new Set([
  "chat.postMessage",
  "conversations.create",
  "conversations.invite",
  "reactions.add",
  "reactions.remove",
]);

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
};

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
      has_token: store.tokens.all().some((token) => token.token_type === "user" && token.user_id === user.user_id),
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
        .filter((message) => message.channel_id === channelId && !message.subtype)
        .sort((a, b) => Number(a.ts) - Number(b.ts))
        .map(toUiMessage)
    : [];
  return { team: team ? { id: team.team_id, name: team.name } : null, users, channels, messages };
}

export function userToken(slack: SlackServer, userId: string): string | null {
  const store = getSlackStore(slack.store);
  const user = store.users.findOneBy("user_id", userId);
  if (!user || user.is_bot || user.deleted) return null;
  const existing = store.tokens.all().find((token) => token.token_type === "user" && token.user_id === userId);
  if (existing) return existing.token;
  const token = `xoxp-worlds-${crypto.randomUUID()}`;
  store.tokens.insert({ token, token_type: "user", team_id: user.team_id, user_id: userId, scopes: USER_SCOPES });
  return token;
}
