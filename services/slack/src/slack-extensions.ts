import type { createServer } from "@emulators/core";

type SlackApp = ReturnType<typeof createServer>["app"];

const AGENT_SESSION_STATUSES = new Set(["processing", "active"]);

async function slackArgs(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

export function registerSlackExtensions(app: SlackApp): void {
  app.post("/api/agents.sessions.setStatus", async (c) => {
    if (!c.get("authUser")) {
      return c.json({ ok: false, error: "not_authed" });
    }
    const args = await slackArgs(c.req.raw);
    if (!args.channel_id || !args.thread_ts) {
      return c.json({ ok: false, error: "invalid_arguments" });
    }
    if (!AGENT_SESSION_STATUSES.has(String(args.status))) {
      return c.json({ ok: false, error: "invalid_status" });
    }
    return c.json({ ok: true });
  });

  app.notFound((c) =>
    c.req.path.startsWith("/api/")
      ? c.json({ ok: false, error: "unknown_method" })
      : c.json(
          { message: "Not Found", documentation_url: "https://github.com/empirical-run/worlds" },
          404,
        ),
  );
}
