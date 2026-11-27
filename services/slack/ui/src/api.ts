export type User = {
  id: string;
  name: string;
  real_name: string;
  is_bot: boolean;
  has_token: boolean;
};

export type Channel = {
  id: string;
  name: string;
  is_private: boolean;
  topic: string;
  members: string[];
};

export type Reaction = { name: string; users: string[]; count: number };

export type FileRef = { id: string; name: string; mimetype: string; size: number };

export type ImageRef = { file_id?: string; url?: string; alt: string };

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
  files: FileRef[];
  images: ImageRef[];
};

export type WorldState = {
  team: { id: string; name: string } | null;
  users: User[];
  channels: Channel[];
  messages: Message[];
};

export class Unauthorized extends Error {}

export const SLACK_BASE = "";

const NOT_SIGNED_IN = "Sign in at makeworlds.dev with an account in this world's team.";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${SLACK_BASE}${path}`, { ...init, headers });
  if (response.status === 401) throw new Unauthorized(NOT_SIGNED_IN);
  const body = (await response.json()) as T & { ok: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function fetchState(channelId: string | null): Promise<WorldState> {
  const query = channelId ? `?channel=${encodeURIComponent(channelId)}` : "";
  return call<WorldState>(`/_worlds/slack/state${query}`);
}

export function actAs<T = Record<string, unknown>>(
  userId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  return call<T>("/_worlds/slack/act", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, method, args }),
  });
}

const fileUrls = new Map<string, Promise<string>>();

export function fileObjectUrl(fileId: string): Promise<string> {
  const cached = fileUrls.get(fileId);
  if (cached) return cached;
  const pending = fetch(`${SLACK_BASE}/_worlds/slack/files/${encodeURIComponent(fileId)}`).then(
    async (response) => {
      if (response.status === 401) throw new Unauthorized(NOT_SIGNED_IN);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return URL.createObjectURL(await response.blob());
    },
  );
  pending.catch(() => fileUrls.delete(fileId));
  fileUrls.set(fileId, pending);
  return pending;
}

export async function uploadAs(upload: {
  userId: string;
  channel: string;
  threadTs?: string;
  text: string;
  file: File;
}): Promise<void> {
  const form = new FormData();
  form.set("user_id", upload.userId);
  form.set("channel", upload.channel);
  if (upload.threadTs) form.set("thread_ts", upload.threadTs);
  if (upload.text) form.set("text", upload.text);
  form.set("file", upload.file, upload.file.name);
  const response = await fetch(`${SLACK_BASE}/_worlds/slack/upload`, {
    method: "POST",
    body: form,
  });
  if (response.status === 401) throw new Unauthorized(NOT_SIGNED_IN);
  const body = (await response.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
}
