import createFetchClient, { type ClientOptions } from "openapi-fetch";

import type { paths } from "./openapi.js";

export type * from "./openapi.js";

export type WorldsClientOptions = ClientOptions & { apiKey?: string };

export function createClient({
  apiKey,
  baseUrl = "https://makeworlds.dev",
  ...options
}: WorldsClientOptions = {}) {
  const client = createFetchClient<paths>({ baseUrl, ...options });
  if (apiKey) {
    client.use({
      onRequest({ request }) {
        request.headers.set("authorization", `Bearer ${apiKey}`);
      },
    });
  }
  return client;
}

export type WorldsClient = ReturnType<typeof createClient>;
