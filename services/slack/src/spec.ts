import type { z } from "@hono/zod-openapi";

import type { SlackSpecSchema, SlackStateSchema } from "./contract";

export type SlackSpec = z.output<typeof SlackSpecSchema>;

export type SlackState = z.output<typeof SlackStateSchema>;

export type SlackAppState = SlackState["apps"][number];

export const ACTING_METHODS = [
  "chat.postMessage",
  "conversations.create",
  "conversations.invite",
  "reactions.add",
  "reactions.remove",
] as const;

export function slackSpecProblems(spec: SlackSpec): string[] {
  const duplicate = (values: string[]) =>
    values.find((value, index) => values.indexOf(value) !== index);
  const problems: string[] = [];
  const duplicateUser = duplicate((spec.users ?? []).map((entry) => entry.name));
  if (duplicateUser) problems.push(`users: duplicate name ${duplicateUser}`);
  const duplicateChannel = duplicate((spec.channels ?? []).map((entry) => entry.name));
  if (duplicateChannel) problems.push(`channels: duplicate name ${duplicateChannel}`);
  const clientId = duplicate(
    (spec.apps ?? []).flatMap((app) =>
      app.credentials?.client_id ? [app.credentials.client_id] : [],
    ),
  );
  if (clientId) problems.push(`apps: duplicate client_id ${clientId}`);
  const names = new Set(
    (spec.users ?? []).flatMap((user) => [user.name, ...(user.id ? [user.id] : [])]),
  );
  const channelNames = new Set((spec.channels ?? []).map((channel) => channel.name));
  for (const channel of spec.channels ?? []) {
    for (const member of channel.members)
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
    if (app.install && !names.has(app.install.installer))
      problems.push(`apps[${index}].install.installer: unknown user ${app.install.installer}`);
    for (const channel of app.install?.channels ?? [])
      if (!channelNames.has(channel))
        problems.push(`apps[${index}].install.channels: unknown channel ${channel}`);
  }
  return problems;
}
