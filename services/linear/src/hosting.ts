import type { ServiceHosting, WorldContext } from "@worlds/contract/hosting";

import { isLinearHost } from "./contract";
import { LinearService } from "./service";
import type { LinearSpec, LinearState } from "./spec";

function origins(world: WorldContext) {
  return { app: world.origin("linear"), api: world.origin("linear-api") };
}

export const linearHosting: ServiceHosting<LinearSpec, LinearState> = {
  runtime(storage) {
    const linear = new LinearService(storage);
    return {
      setup: (spec, world) => linear.setup(spec, origins(world)),
      state: () => linear.state(),
      fetch: async (request, host, world) =>
        isLinearHost(host)
          ? linear.fetch(request, host, origins(world))
          : Response.json({ error: "Not found" }, { status: 404 }),
      alarm: (world) => linear.alarm(world ? origins(world) : null),
      nextDue: () => linear.nextDue(),
    };
  },
  page: (request, url, host) =>
    host === "linear" &&
    request.method === "GET" &&
    !url.pathname.startsWith("/oauth/") &&
    !url.pathname.startsWith("/_worlds/")
      ? "members-only"
      : null,
  error: (status, code, message) =>
    Response.json(
      {
        errors: [
          {
            message,
            extensions: { type: "invalid input", code: code.toUpperCase(), userError: true },
          },
        ],
      },
      { status },
    ),
};
