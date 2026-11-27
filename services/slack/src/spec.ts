import type { SlackCredentials, SlackManifest } from "./manifest";

export type SlackUserSpec = {
  id?: string;
  name: string;
  real_name?: string;
  email?: string;
  token?: string;
};

export type SlackMessageSpec = {
  user: string;
  text: string;
  replies?: { user: string; text: string }[];
};

export type SlackChannelSpec = {
  id?: string;
  name: string;
  private?: boolean;
  topic?: string;
  members?: string[];
  messages?: SlackMessageSpec[];
};

export type SlackInstallSpec = {
  installer?: string;
  bot_user_id?: string;
  bot_token?: string;
  channels?: string[];
};

export type SlackAppSpec = {
  manifest: SlackManifest;
  credentials?: Partial<SlackCredentials>;
  install?: boolean | SlackInstallSpec;
};

export type SlackSpec = {
  team?: { id?: string; name?: string; domain?: string };
  users?: SlackUserSpec[];
  channels?: SlackChannelSpec[];
  apps?: SlackAppSpec[];
};

export type SlackAppState = {
  app_id: string;
  manifest: SlackManifest;
  credentials: SlackCredentials;
  install:
    | (Required<Pick<SlackInstallSpec, "installer" | "bot_user_id" | "bot_token">> & {
        channels: string[];
      })
    | null;
};

export type SlackState = {
  team: { id: string; name: string; domain: string };
  users: (Required<Pick<SlackUserSpec, "id" | "name" | "real_name" | "email">> & {
    token: string | null;
  })[];
  channels: (Required<Pick<SlackChannelSpec, "id" | "name" | "private" | "topic">> & {
    members: string[];
    messages: SlackMessageSpec[];
  })[];
  apps: SlackAppState[];
};

export const DEFAULT_SLACK_SPEC: SlackSpec = {
  team: { name: "Worlds", domain: "worlds" },
  users: [{ name: "alice", real_name: "Alice Tester", email: "alice@worlds.test" }],
  channels: [{ name: "general", topic: "General discussion", members: ["alice"] }],
};

export function unknownReferences(spec: SlackSpec): string[] {
  const names = new Set(
    (spec.users ?? []).flatMap((user) => [user.name, ...(user.id ? [user.id] : [])]),
  );
  const channelNames = new Set((spec.channels ?? []).map((channel) => channel.name));
  const problems: string[] = [];
  for (const channel of spec.channels ?? []) {
    for (const member of channel.members ?? [])
      if (!names.has(member))
        problems.push(`channels.${channel.name}.members: unknown user ${member}`);
    for (const message of channel.messages ?? []) {
      for (const author of [message.user, ...(message.replies ?? []).map((reply) => reply.user)]) {
        if (!names.has(author))
          problems.push(`channels.${channel.name}.messages: unknown user ${author}`);
      }
    }
  }
  for (const [index, app] of (spec.apps ?? []).entries()) {
    const install = typeof app.install === "object" ? app.install : null;
    if (install?.installer && !names.has(install.installer))
      problems.push(`apps[${index}].install.installer: unknown user ${install.installer}`);
    for (const channel of install?.channels ?? [])
      if (!channelNames.has(channel))
        problems.push(`apps[${index}].install.channels: unknown channel ${channel}`);
  }
  return problems;
}
