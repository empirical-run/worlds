import type { RouterContextProvider } from "react-router";

import { workerContext } from "../worker/context";
import type { OpenApiDocument } from "./openapi";

export async function loadApiSpec(
  context: Readonly<RouterContextProvider>,
  request: Request,
): Promise<OpenApiDocument> {
  const { env } = context.get(workerContext);
  const response = await env.API.fetch(new Request(new URL("/api/openapi.json", request.url)));
  if (!response.ok) {
    throw new Response("The API description is unavailable.", { status: 502 });
  }
  return (await response.json()) as OpenApiDocument;
}
