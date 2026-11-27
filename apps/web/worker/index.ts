import { database } from "@worlds/db";
import { createRequestHandler, RouterContextProvider } from "react-router";

import { accountFor, handleAuth } from "./auth";
import { workerContext } from "./context";
import type { Env } from "./env";

const renderPage = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return env.API.fetch(request);
    const db = database(env.DB);
    const auth = await handleAuth(request, env, url, db);
    if (auth) return auth;
    const context = new RouterContextProvider();
    context.set(workerContext, { env, db, account: await accountFor(request, db) });
    return renderPage(request, context);
  },
} satisfies ExportedHandler<Env>;
