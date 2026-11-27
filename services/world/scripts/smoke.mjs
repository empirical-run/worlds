import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { WebClient } from "@slack/web-api";

const base = process.env.WORLDS_URL ?? "http://localhost:8787/w/world_smoketest0000000000";
const signingSecret = process.env.SLACK_SIGNING_SECRET ?? "worlds-signing-secret";
const clientId = process.env.SLACK_CLIENT_ID ?? "worlds-client-id";
const clientSecret = process.env.SLACK_CLIENT_SECRET ?? "worlds-client-secret";
const redirectUri = "http://localhost:8788/oauth/callback";
const userToken = process.env.SLACK_USER_TOKEN ?? "xoxp-alice";
const apiKey = process.env.WORLDS_API_KEY ?? "wk_live_smoke0smoke0smoke0smoke0smoke0smoke00";
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
  req.on("end", async () => {
    const payload = JSON.parse(body || "{}");
    const retryNum = req.headers["x-slack-retry-num"];
    const text = payload.event?.text ?? "";
    events.push({
      valid: verified(req.headers, body),
      type: payload.event?.type,
      text,
      eventId: payload.event_id,
      retryNum,
      retryReason: req.headers["x-slack-retry-reason"],
      fileIds: payload.event?.files?.map((file) => file.id) ?? [],
    });
    if (!retryNum && text.includes("fail once")) {
      res.statusCode = 500;
      return res.end("fail");
    }
    if (!retryNum && text.includes("stall once")) await sleep(3500);
    res.end("ok");
  });
}).listen(8788);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = predicate();
    if (found) return found;
    await sleep(100);
  }
  return undefined;
}

function mentionAttempts(text) {
  return events.filter((event) => event.type === "app_mention" && event.text?.includes(text));
}

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
  const anonymous = await fetch(`${base}/_worlds/slack/state`);
  assert(anonymous.status === 401, "control routes refuse requests without the team's key");
  const state = await fetch(`${base}/_worlds/slack/state`, { headers: { authorization: `Bearer ${apiKey}` } });
  assert(state.ok, "the team's API key opens the world's control routes");
  const missing = await fetch(`${base.replace(/world_[a-z0-9]+/, "world_doesnotexist00000000")}/api/auth.test`, { method: "POST" });
  assert(missing.status === 404, "an unknown world answers world_not_found");
  const access = await install();
  assert(access.ok && access.access_token.startsWith("xoxb-"), "OAuth install returns a bot token");

  const bot = new WebClient(access.access_token, { slackApiUrl });
  const human = new WebClient(userToken, { slackApiUrl });
  const channel = `smoke-${Date.now()}`;
  const created = await human.conversations.create({ name: channel });
  await bot.conversations.join({ channel: created.channel.id });

  const mention = await human.chat.postMessage({ channel: created.channel.id, text: `<@${access.bot_user_id}> run the login tests` });
  await bot.chat.postMessage({ channel: created.channel.id, thread_ts: mention.ts, text: "On it" });
  const thread = await bot.conversations.replies({ channel: created.channel.id, ts: mention.ts });
  assert(thread.messages.at(-1)?.text === "On it", "bot reply lands in the thread");

  const status = await bot.apiCall("agents.sessions.setStatus", { channel_id: created.channel.id, thread_ts: mention.ts, status: "processing" });
  assert(status.ok, "agents.sessions.setStatus succeeds");
  const unknown = await fetch(`${slackApiUrl}chat.doesNotExist`, { method: "POST", headers: { authorization: `Bearer ${access.access_token}` } });
  assert(unknown.status === 200 && (await unknown.json()).error === "unknown_method", "unknown methods answer 200 unknown_method like Slack");

  const appMention = await waitFor(() => mentionAttempts("run the login tests")[0]);
  assert(appMention, "app_mention event is delivered");

  await human.chat.postMessage({ channel: created.channel.id, text: `<@${access.bot_user_id}> fail once` });
  const failed = await waitFor(() => mentionAttempts("fail once").length >= 2 && mentionAttempts("fail once"));
  assert(
    failed && failed[1].retryNum === "1" && failed[1].retryReason === "http_error" && failed[1].eventId === failed[0].eventId,
    "a 500 is retried with X-Slack-Retry-Num 1, reason http_error, same event_id",
  );

  const started = Date.now();
  await human.chat.postMessage({ channel: created.channel.id, text: `<@${access.bot_user_id}> stall once` });
  assert(Date.now() - started < 2000, "chat.postMessage returns without waiting for the event receiver");
  const stalled = await waitFor(() => mentionAttempts("stall once").length >= 2 && mentionAttempts("stall once"));
  assert(stalled && stalled[1].retryNum === "1" && stalled[1].retryReason === "http_timeout", "a receiver slower than 3s is retried with reason http_timeout");

  const screenshot = randomBytes(3_000_000);
  const target = await human.files.getUploadURLExternal({ filename: "screenshot.png", length: screenshot.length });
  await fetch(target.upload_url, { method: "POST", body: screenshot });
  await human.files.completeUploadExternal({
    files: [{ id: target.file_id, title: "screenshot" }],
    channel_id: created.channel.id,
    initial_comment: `<@${access.bot_user_id}> what broke in this screenshot`,
  });
  const fileMention = await waitFor(() => mentionAttempts("what broke in this screenshot")[0]);
  assert(fileMention?.fileIds.includes(target.file_id), "a file shared with an @mention sends app_mention with the file");
  const info = await bot.files.info({ file: target.file_id });
  assert(Boolean(info.file.thumb_360), "image files report thumbnails");
  const download = await fetch(info.file.url_private_download, { headers: { authorization: `Bearer ${access.access_token}` } });
  assert(Buffer.from(await download.arrayBuffer()).equals(screenshot), "the bot downloads the file's bytes over url_private_download");

  await sleep(1000);
  assert(mentionAttempts("run the login tests").length === 1, "a 200 is not retried");
  assert(events.every((event) => event.valid), "every event carries a valid Slack signature");
} finally {
  receiver.close();
}
