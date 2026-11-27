import { database } from "@worlds/db";
import { createRequestHandler, RouterContextProvider } from "react-router";

import { accountFor, handleAuth } from "./auth";
import { workerContext } from "./context";
import type { Env } from "./env";

const serverBuild = () => import("virtual:react-router/server-build");
const renderPage = createRequestHandler(serverBuild, import.meta.env.MODE);

async function archivedAsset(pathname: string, archive: R2Bucket) {
  const object = await archive.get(pathname.slice(1));
  if (!object) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return env.API.fetch(request);
    }
    if (url.pathname.startsWith("/assets/")) {
      return archivedAsset(url.pathname, env.ASSETS_ARCHIVE);
    }
    if (url.pathname === "/__version") {
      return new Response((await serverBuild()).assets.version, {
        headers: { "cache-control": "no-store" },
      });
    }
    const db = database(env.DB);
    const auth = await handleAuth(request, env, url, db);
    if (auth) {
      return auth;
    }
    const context = new RouterContextProvider();
    context.set(workerContext, { env, db, account: await accountFor(request, db) });
    return renderPage(request, context);
  },
} satisfies ExportedHandler<Env>;
