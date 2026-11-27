import type { ServiceHosting } from "@worlds/contract/hosting";

import { INSPECTOR_PATH, SlackService } from "./service";
import type { SlackSpec, SlackState } from "./spec";

export const slackHosting: ServiceHosting<SlackSpec, SlackState> = {
  runtime(storage) {
    const slack = new SlackService(storage);
    return {
      setup: (spec, world) => slack.setup(spec, world.origin("slack")),
      state: () => slack.state(),
      fetch: (request) => slack.fetch(request, new URL(request.url).origin),
      alarm: () => slack.alarm(),
      nextDue: () => slack.nextDue(),
    };
  },
  page(request, url) {
    if (url.pathname.startsWith("/assets/")) return "asset";
    if (url.pathname === INSPECTOR_PATH) return "members-only";
    return request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")
      ? "ui"
      : null;
  },
  error: (status, code) => Response.json({ ok: false, error: code }, { status }),
  bannerStyle:
    "body > .content, body > .checkout-layout { min-height: calc(100vh - 42px - var(--worlds-banner-height)); }",
};
