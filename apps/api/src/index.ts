import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { authenticate } from "./auth";
import { apiError, type AppEnv } from "./context";
import { apiKeys } from "./routes/api-keys";
import { teams } from "./routes/teams";
import { worlds } from "./routes/worlds";

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (result.success) return;
    return c.json(apiError("invalid_request", result.error.issues[0]?.message ?? "Invalid request."), 400);
  },
});

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "An API key from Settings on makeworlds.dev, as Authorization: Bearer wk_live_…",
});
app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "worlds_session",
  description: "The session from signing in at makeworlds.dev. Requests that change data must come from makeworlds.dev.",
});

app.use("/api/*", authenticate);
app.route("/", teams);
app.route("/", apiKeys);
app.route("/", worlds);

app.doc31("/api/openapi.json", {
  openapi: "3.1.0",
  info: { title: "Worlds API", version: "1" },
  servers: [{ url: "https://makeworlds.dev" }],
});

app.notFound((c) => c.json(apiError("not_found", "No such endpoint."), 404));
app.onError((error, c) => {
  if (error instanceof HTTPException && error.status < 500) {
    return c.json(apiError("invalid_request", error.message), error.status);
  }
  console.error(error);
  return c.json(apiError("internal", "Something went wrong."), 500);
});

export default app;
