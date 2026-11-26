import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { WebClient } from "@slack/web-api";

const base = process.env.WORLDS_URL ?? "http://localhost:8787";
const signingSecret = process.env.SLACK_SIGNING_SECRET ?? "worlds-signing-secret";
const clientId = process.env.SLACK_CLIENT_ID ?? "worlds-client-id";
const clientSecret = process.env.SLACK_CLIENT_SECRET ?? "worlds-client-secret";
const redirectUri = "http://localhost:8788/oauth/callback";
const slackApiUrl = `${base}/api/`;

const events = [];

function verified(headers, body) {
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${headers["x-slack-request-timestamp"]}:${body}`).digest("hex")}`;
  const actual = headers["x-slack-signature"] ?? "";
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    events.push({ valid: verified(req.headers, body), type: payload.event?.type, text: payload.event?.text });
    res.end("ok");
  });
}).listen(8788);

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

async function install() {
  const authorize = await fetch(
    `${base}/oauth/v2/authorize?client_id=${clientId}&scope=app_mentions:read,chat:write&redirect_uri=${encodeURIComponent(redirectUri)}&state=smoke`,
  );
  const html = await authorize.text();
  const userId = html.match(/name="user_id"[^>]*value="([^"]+)"/)?.[1];
  const callback = await fetch(`${base}/oauth/v2/authorize/callback`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ user_id: userId, client_id: clientId, redirect_uri: redirectUri, scope: "app_mentions:read,chat:write", state: "smoke" }),
  });
  const code = new URL(callback.headers.get("location")).searchParams.get("code");
  return new WebClient(undefined, { slackApiUrl }).oauth.v2.access({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
}

try {
  await fetch(`${base}/_worlds/reset`, { method: "POST" });
  const access = await install();
  assert(access.ok && access.access_token.startsWith("xoxb-"), "OAuth install returns a bot token");

  const bot = new WebClient(access.access_token, { slackApiUrl });
  const human = new WebClient("xoxp-alice", { slackApiUrl });
  const channel = `smoke-${Date.now()}`;
  const created = await human.conversations.create({ name: channel });
  await bot.conversations.join({ channel: created.channel.id });

  const mention = await human.chat.postMessage({ channel: created.channel.id, text: `<@${access.bot_user_id}> run the login tests` });
  await bot.chat.postMessage({ channel: created.channel.id, thread_ts: mention.ts, text: "On it" });
  const thread = await bot.conversations.replies({ channel: created.channel.id, ts: mention.ts });
  assert(thread.messages.at(-1)?.text === "On it", "bot reply lands in the thread");

  await new Promise((resolve) => setTimeout(resolve, 1000));
  const appMention = events.find((event) => event.type === "app_mention");
  assert(appMention?.text?.includes("run the login tests"), "app_mention event is delivered");
  assert(events.every((event) => event.valid), "every event carries a valid Slack signature");
} finally {
  receiver.close();
}
