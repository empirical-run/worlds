import type { ServiceHost, ServiceName } from "@worlds/services";

export type Page = "members-only" | "slack-ui" | null;

type PageRule = (request: Request, url: URL, host: ServiceHost) => Page;

export const PAGES: { [Name in ServiceName]: PageRule } = {
  slack: (request, url) =>
    request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")
      ? "slack-ui"
      : null,
  jira: (_request, url, host) =>
    host === "jira" && (url.pathname === "/" || url.pathname.startsWith("/browse/"))
      ? "members-only"
      : null,
};
