import type { ServiceHosting, WorldContext } from "@worlds/contract/hosting";

import { isGoogleHost } from "./contract";
import { GoogleService } from "./service";
import type { GoogleSpec, GoogleState } from "./spec";

function origins(world: WorldContext) {
  return { accounts: world.origin("google"), api: world.origin("google-api") };
}

const PUBLIC_PREFIXES = ["/o/oauth2/", "/js/", "/picker", "/avatar/", "/_worlds/"];

export const googleHosting: ServiceHosting<GoogleSpec, GoogleState> = {
  runtime(storage) {
    const google = new GoogleService(storage);
    return {
      setup: (spec, world) => google.setup(spec, origins(world)),
      state: () => google.state(),
      fetch: async (request, host, world) =>
        isGoogleHost(host)
          ? google.fetch(request, host, origins(world))
          : Response.json({ error: { code: 404, message: "Not Found" } }, { status: 404 }),
      alarm: async () => {},
      nextDue: async () => null,
    };
  },
  page: (request, url, host) =>
    host === "google" &&
    request.method === "GET" &&
    !PUBLIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
      ? "members-only"
      : null,
  error: (status, code, message) =>
    Response.json(
      { error: { code: status, message, errors: [{ message, domain: "global", reason: code }] } },
      { status },
    ),
};
