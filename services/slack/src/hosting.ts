import type { ServiceHosting } from "@worlds/contract/hosting";

import { SlackService } from "./service";
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
  page: (request, url) =>
    request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")
      ? "ui"
      : null,
};
