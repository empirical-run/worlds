import type { RouterContextProvider } from "react-router";
import { workerContext } from "../worker/context";

export type ApiError = { code: string; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

type Call = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown };

export async function callApi<T>(context: Readonly<RouterContextProvider>, request: Request, path: string, call: Call = {}): Promise<ApiResult<T>> {
  const { env } = context.get(workerContext);
  const method = call.method ?? "GET";
  const url = new URL(path, request.url);
  const headers = new Headers({ accept: "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  if (method !== "GET") headers.set("origin", url.origin);
  if (call.body !== undefined) headers.set("content-type", "application/json");
  const response = await env.API.fetch(new Request(url, { method, headers, body: call.body === undefined ? undefined : JSON.stringify(call.body) }));
  if (response.status === 204) return { ok: true, data: undefined as T };
  const body = (await response.json()) as T | { error: ApiError };
  if (!response.ok) return { ok: false, status: response.status, error: (body as { error: ApiError }).error };
  return { ok: true, data: body as T };
}

export async function requireApi<T>(context: Readonly<RouterContextProvider>, request: Request, path: string): Promise<T> {
  const result = await callApi<T>(context, request, path);
  if (!result.ok) throw new Response(result.error.message, { status: result.status });
  return result.data;
}
