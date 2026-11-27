import type { ServiceHosting, WorldContext } from "@worlds/contract/hosting";

import { isJiraHost } from "./contract";
import { JiraService } from "./service";
import type { JiraSpec, JiraState } from "./spec";

function origins(world: WorldContext) {
  return {
    site: world.origin("jira"),
    auth: world.origin("jira-auth"),
    api: world.origin("jira-api"),
  };
}

export const jiraHosting: ServiceHosting<JiraSpec, JiraState> = {
  runtime(storage) {
    const jira = new JiraService(storage);
    return {
      setup: (spec, world) => jira.setup(spec, origins(world)),
      state: () => jira.state(),
      fetch: async (request, host, world) =>
        isJiraHost(host)
          ? jira.fetch(request, host, origins(world))
          : Response.json({ code: 404, message: "Not Found" }, { status: 404 }),
      alarm: (world) => jira.alarm(world ? origins(world) : null),
      nextDue: () => jira.nextDue(),
    };
  },
  page: (_request, url, host) =>
    host === "jira" && (url.pathname === "/" || url.pathname.startsWith("/browse/"))
      ? "members-only"
      : null,
  error: (status, _code, message) =>
    Response.json({ errorMessages: [message], errors: {} }, { status }),
  bannerStyle: "body > .content { min-height: calc(100vh - 42px - var(--worlds-banner-height)); }",
};
