import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("docs", "routes/docs.tsx"),
  route("docs/api", "routes/api-reference.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("account", "routes/account.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
