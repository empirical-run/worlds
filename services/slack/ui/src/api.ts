import type { ApiError } from "@worlds/contract";
import type { z } from "zod";

import type {
  SlackActRequestSchema,
  SlackWebApiResponse,
  SlackWorldState,
} from "../../src/contract";

export type WorldState = SlackWorldState;

export type User = WorldState["users"][number];

export type Channel = WorldState["channels"][number];

export type Message = WorldState["messages"][number];

export type FileRef = Message["files"][number];

export type ImageRef = Message["images"][number];

export type ActingMethod = z.output<typeof SlackActRequestSchema>["method"];

export class Unauthorized extends Error {}

export const SLACK_BASE = "";

const NOT_SIGNED_IN = "Sign in at makeworlds.dev with an account in this world's team.";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${SLACK_BASE}${path}`, { ...init, headers });
  if (response.status === 401) {
    throw new Unauthorized(NOT_SIGNED_IN);
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(failure?.error.message ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function callSlack(path: string, init: RequestInit): Promise<SlackWebApiResponse> {
  const body = await call<SlackWebApiResponse>(path, init);
  if (!body.ok) {
    throw new Error(body.error ?? "Slack returned an error.");
  }
  return body;
}

export function fetchState(channelId: string | null): Promise<WorldState> {
  const query = channelId ? `?channel=${encodeURIComponent(channelId)}` : "";
  return call<WorldState>(`/_worlds/slack/state${query}`);
}

export function actAs(
  userId: string,
  method: ActingMethod,
  args: Record<string, unknown>,
): Promise<SlackWebApiResponse> {
  return callSlack("/_worlds/slack/act", {
    method: "POST",
    body: JSON.stringify({ user: userId, method, args }),
  });
}

const fileUrls = new Map<string, Promise<string>>();

export function fileObjectUrl(fileId: string): Promise<string> {
  const cached = fileUrls.get(fileId);
  if (cached) {
    return cached;
  }
  const pending = fetch(`${SLACK_BASE}/_worlds/slack/files/${encodeURIComponent(fileId)}`).then(
    async (response) => {
      if (response.status === 401) {
        throw new Unauthorized(NOT_SIGNED_IN);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
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
  form.set("user", upload.userId);
  form.set("channel", upload.channel);
  if (upload.threadTs) {
    form.set("thread_ts", upload.threadTs);
  }
  if (upload.text) {
    form.set("text", upload.text);
  }
  form.set("file", upload.file, upload.file.name);
  await callSlack("/_worlds/slack/upload", { method: "POST", body: form });
}
