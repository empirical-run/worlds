import type { Store } from "@emulators/core";
import { getSlackStore } from "@emulators/slack";

import type { SlackSpec, SlackState } from "./spec";

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const USER_SCOPES = [
  "chat:write",
  "channels:read",
  "channels:write",
  "channels:history",
  "groups:read",
  "reactions:write",
  "users:read",
  "files:write",
  "files:read",
];

export function slackId(prefix: string): string {
  return `${prefix}${[...crypto.getRandomValues(new Uint8Array(10))].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("")}`;
}

export function seedWorkspace(store: Store, spec: SlackSpec): Omit<SlackState, "apps"> {
  const slack = getSlackStore(store);
  const now = Math.floor(Date.now() / 1000);
  const team = {
    id: spec.team.id ?? slackId("T"),
    name: spec.team.name,
    domain: spec.team.domain,
  };
  slack.teams.insert({ team_id: team.id, name: team.name, domain: team.domain });

  const users = (spec.users ?? []).map((user) => ({
    id: user.id ?? slackId("U"),
    name: user.name,
    real_name: user.real_name ?? user.name,
    email: user.email ?? `${user.name}@${team.domain}.test`,
    token: user.token ?? null,
  }));
  for (const user of users) {
    slack.users.insert({
      user_id: user.id,
      team_id: team.id,
      name: user.name,
      real_name: user.real_name,
      email: user.email,
      is_admin: false,
      is_bot: false,
      deleted: false,
      profile: {
        display_name: user.name,
        real_name: user.real_name,
        email: user.email,
        image_48: "",
        image_192: "",
        real_name_normalized: user.real_name,
        display_name_normalized: user.name,
        status_text: "",
        status_emoji: "",
        status_emoji_display_info: [],
        status_expiration: 0,
      },
      presence: "active",
      manual_presence: "auto",
      connection_count: 1,
      last_activity: now,
    });
    if (user.token) {
      slack.tokens.insert({
        token: user.token,
        token_type: "user",
        team_id: team.id,
        user_id: user.id,
        scopes: USER_SCOPES,
      });
    }
  }

  const channels = (spec.channels ?? []).map((channel) => ({
    id: channel.id ?? slackId(channel.private ? "G" : "C"),
    name: channel.name,
    private: channel.private ?? false,
    topic: channel.topic ?? "",
    members: channel.members.map((member) => seededUserId(users, member)),
    messages: channel.messages ?? [],
  }));
  for (const channel of channels) {
    const creator = channel.members[0];
    if (!creator) throw new Error(`slack spec: channel ${channel.name} has no members`);
    slack.channels.insert({
      channel_id: channel.id,
      team_id: team.id,
      name: channel.name,
      is_channel: !channel.private,
      is_private: channel.private,
      is_archived: false,
      topic: { value: channel.topic, creator, last_set: now },
      purpose: { value: "", creator, last_set: now },
      members: channel.members,
      creator,
      num_members: channel.members.length,
    });
  }
  return { team, users, channels };
}

export function seededUserId(users: { id: string; name: string }[], ref: string): string {
  const user = users.find((candidate) => candidate.name === ref || candidate.id === ref);
  if (!user) throw new Error(`slack spec: unknown user ${ref}`);
  return user.id;
}
