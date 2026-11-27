import { type ApiError, createClient } from "makeworlds";
import { data, type RouterContextProvider } from "react-router";

import { workerContext } from "../worker/context";
import type { ActionResult } from "./components/forms";

type ApiResult<T> =
  | { data: T; error?: never; response: Response }
  | { data?: never; error: ApiError; response: Response };

export function api(context: Readonly<RouterContextProvider>, request: Request) {
  const { env } = context.get(workerContext);
  const { origin } = new URL(request.url);
  const cookie = request.headers.get("cookie");
  return createClient({
    baseUrl: origin,
    fetch: (input) => env.API.fetch(input),
    headers: { origin, ...(cookie ? { cookie } : {}) },
  });
}

export function orThrow<T>(result: ApiResult<T>): T {
  if (result.error) {
    throw new Response(result.error.error.message, { status: result.response.status });
  }
  return result.data;
}

export function actionData<T>(
  intent: string,
  result: ApiResult<T>,
  onSuccess: (data: T) => Omit<ActionResult, "intent"> = () => ({}),
) {
  if (result.error) {
    return data<ActionResult>(
      { intent, error: result.error.error.message },
      result.response.status,
    );
  }
  return data<ActionResult>({ intent, ...onSuccess(result.data) });
}

export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
