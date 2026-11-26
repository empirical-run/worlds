export type User = { id: string; name: string; real_name: string; is_bot: boolean; has_token: boolean };

export type Channel = { id: string; name: string; is_private: boolean; topic: string; members: string[] };

export type Reaction = { name: string; users: string[]; count: number };

export type Message = {
  ts: string;
  thread_ts?: string;
  user: string;
  text: string;
  reply_count: number;
  reply_users: string[];
  reactions: Reaction[];
  bot_name?: string;
  edited: boolean;
};

export type WorldState = {
  team: { id: string; name: string } | null;
  users: User[];
  channels: Channel[];
  messages: Message[];
};

export class Unauthorized extends Error {}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 401) throw new Unauthorized("The admin token was rejected.");
  const body = (await response.json()) as T & { ok: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function fetchState(token: string, channelId: string | null): Promise<WorldState> {
  const query = channelId ? `?channel=${encodeURIComponent(channelId)}` : "";
  return call<WorldState>(token, `/_worlds/slack/state${query}`);
}

export function actAs<T = Record<string, unknown>>(
  token: string,
  userId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  return call<T>(token, "/_worlds/slack/act", { method: "POST", body: JSON.stringify({ user_id: userId, method, args }) });
}
