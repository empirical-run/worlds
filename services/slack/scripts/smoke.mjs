import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { WebClient } from "@slack/web-api";

const apiUrl = process.env.WORLDS_API_URL ?? "http://localhost:8791";
const worldsOrigin = (worldId) => `http://${worldId.slice("world_".length)}-slack.localhost:8787`;
const redirectUri = "http://localhost:8788/oauth/callback";
const manifest = {
  display_information: { name: "Smoke" },
  features: { bot_user: { display_name: "smoke" } },
  oauth_config: {
    redirect_urls: [redirectUri],
    scopes: { bot: ["app_mentions:read", "chat:write", "channels:history", "files:read"] },
  },
  settings: {
    event_subscriptions: {
      request_url: "http://localhost:8788/slack/events",
      bot_events: ["app_mention"],
    },
  },
};
const run = Date.now();
const credentials = {
  client_id: `smoke-${run}`,
  client_secret: "smoke-client-secret",
  signing_secret: "smoke-signing-secret",
};
const clientId = credentials.client_id;
const clientSecret = credentials.client_secret;
const signingSecret = credentials.signing_secret;
const apiKey = process.env.WORLDS_API_KEY ?? "wk_live_smoke0smoke0smoke0smoke0smoke0smoke00";
const userToken = `xoxp-smoke-alice-${run}`;
const pinnedBotToken = `xoxb-smoke-pinned-${run}`;
const spec = {
  team: { name: "Smoke", domain: "smoke" },
  users: [
    { name: "alice", real_name: "Alice Tester", email: "alice@smoke.test", token: userToken },
    { name: "bob", real_name: "Bob Tester", email: "bob@smoke.test" },
  ],
  channels: [
    {
      name: "general",
      members: ["alice", "bob"],
      messages: [
        {
          user: "bob",
          text: "hello from the spec",
          replies: [{ user: "alice", text: "a seeded reply" }],
        },
      ],
    },
  ],
  apps: [
    { manifest, credentials },
    {
      manifest: {
        display_information: { name: "Pinned" },
        oauth_config: { scopes: { bot: ["chat:write", "channels:read"] } },
      },
      credentials: { client_id: `pinned-${run}` },
      install: {
        installer: "alice",
        bot_user_id: "U0PINNED0001",
        bot_token: pinnedBotToken,
        channels: ["general"],
      },
    },
    {
      manifest: {
        display_information: { name: "Wildcard" },
        oauth_config: {
          redirect_urls: ["https://*-dashboard.example.com/api/slack/oauth/callback"],
        },
      },
      credentials: { client_id: `wildcard-${run}` },
    },
  ],
};
let base = "";
let slackApiUrl = "";

const events = [];

function verified(headers, body) {
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${headers["x-slack-request-timestamp"]}:${body}`).digest("hex")}`;
  const actual = headers["x-slack-signature"] ?? "";
  return (
    actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
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
    if (!retryNum && text.includes("stall once")) {
      await sleep(3500);
    }
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
    if (found) {
      return found;
    }
    await sleep(100);
  }
  return undefined;
}

function mentionAttempts(text) {
  return events.filter((event) => event.type === "app_mention" && event.text?.includes(text));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    body: new URLSearchParams({
      user_id: userId,
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "app_mentions:read,chat:write",
      state: "smoke",
    }),
  });
  const code = new URL(callback.headers.get("location")).searchParams.get("code");
  return new WebClient(undefined, { slackApiUrl }).oauth.v2.access({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
}

let worldId = "";
try {
  const invalid = await fetch(`${apiUrl}/api/worlds`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Invalid",
      slack: { ...spec, channels: [{ name: "general", members: ["nobody"] }] },
    }),
  });
  assert(
    invalid.status === 400 && (await invalid.json()).error.message.includes("unknown user nobody"),
    "a spec that names an unknown user is refused",
  );
  const noTeam = await fetch(`${apiUrl}/api/worlds`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "No team", slack: { ...spec, team: undefined } }),
  });
  assert(
    noTeam.status === 400 && (await noTeam.json()).error.message.startsWith("slack.team"),
    "a Slack spec without a team is refused",
  );
  const noName = await fetch(`${apiUrl}/api/worlds`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ slack: spec }),
  });
  assert(noName.status === 400, "a world without a name is refused");
  const noService = await fetch(`${apiUrl}/api/worlds`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Nothing" }),
  });
  assert(noService.status === 400, "a world without any service spec is refused");
  const createdWorld = await fetch(`${apiUrl}/api/worlds`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Smoke", slack: spec }),
  });
  const world = await createdWorld.json();
  assert(
    createdWorld.status === 201 && /^T[0-9A-Z]{10}$/.test(world.slack.spec.team.id),
    "POST /api/worlds seeds the world from its spec, with a generated team id",
  );
  worldId = world.id;
  base = worldsOrigin(worldId);
  slackApiUrl = `${base}/api/`;
  const exported = await (
    await fetch(`${apiUrl}/api/worlds/${worldId}/spec`, {
      headers: { authorization: `Bearer ${apiKey}` },
    })
  ).json();
  assert(
    exported.slack.team.id === world.slack.spec.team.id &&
      exported.slack.apps[0].credentials.client_id === clientId &&
      exported.slack.users[0].token === userToken,
    "GET /api/worlds/{id}/spec returns the effective spec",
  );

  const anonymous = await fetch(`${base}/_worlds/slack/state`);
  assert(anonymous.status === 401, "control routes refuse requests without the team's key");
  const state = await fetch(`${base}/_worlds/slack/state`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert(state.ok, "the team's API key opens the world's control routes");
  assert(
    (await anonymous.json()).error?.code === "unauthorized",
    "control routes answer with the API's error shape",
  );
  const control = (path, body) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const minted = await (await control("/_worlds/slack/tokens", { user: "alice" })).json();
  assert(minted.token === userToken, "POST /_worlds/slack/tokens takes a user's name");
  const refused = await control("/_worlds/slack/act", { user: "alice", method: "chat.delete" });
  assert(
    refused.status === 400 && (await refused.json()).error.code === "invalid_request",
    "act refuses methods outside its list",
  );
  const unknownActor = await control("/_worlds/slack/act", {
    user: "nobody",
    method: "chat.postMessage",
    args: { channel: "general", text: "hi" },
  });
  assert(
    unknownActor.status === 400 && (await unknownActor.json()).error.code === "user_not_found",
    "act refuses an unknown user",
  );
  const missing = await fetch(`${worldsOrigin("world_doesnotexist0")}/api/auth.test`, {
    method: "POST",
  });
  assert(missing.status === 404, "an unknown world answers world_not_found");

  const human = new WebClient(userToken, { slackApiUrl });
  assert((await human.auth.test()).user === "alice", "a pinned user token acts as that user");
  const general = world.slack.spec.channels.find((channel) => channel.name === "general");
  const history = await human.conversations.history({ channel: general.id });
  const seeded = history.messages.find((message) => message.text === "hello from the spec");
  assert(seeded?.reply_count === 1, "seeded messages and replies are in the channel");
  const pinnedBot = new WebClient(pinnedBotToken, { slackApiUrl });
  const pinnedAuth = await pinnedBot.auth.test();
  assert(
    pinnedAuth.ok && pinnedAuth.user_id === "U0PINNED0001",
    "a preinstalled app uses its pinned bot user and token",
  );
  assert(
    (await human.conversations.members({ channel: general.id })).members.includes("U0PINNED0001"),
    "the preinstalled bot is in its channels",
  );

  const config = new WebClient(apiKey, { slackApiUrl });
  const restricted = await config
    .apiCall("apps.manifest.create", { manifest: JSON.stringify(manifest) })
    .catch((error) => error.data);
  assert(restricted.error === "restricted_action", "apps come only from the world's spec");
  const appId = world.slack.spec.apps[0].app_id;
  const exportedManifest = await config.apiCall("apps.manifest.export", { app_id: appId });
  assert(
    exportedManifest.manifest.display_information.name === "Smoke",
    "apps.manifest.export returns the manifest",
  );

  const access = await install();
  assert(
    access.ok &&
      access.access_token.startsWith("xoxb-") &&
      access.team.id === world.slack.spec.team.id,
    "OAuth install returns a bot token for the world's team",
  );

  const wildcardClient = world.slack.spec.apps[2].credentials.client_id;
  const authorizeWith = (uri) =>
    fetch(
      `${base}/oauth/v2/authorize?client_id=${wildcardClient}&scope=chat:write&redirect_uri=${encodeURIComponent(uri)}`,
    ).then((r) => r.status);
  assert(
    (await authorizeWith("https://feat-x-dashboard.example.com/api/slack/oauth/callback")) ===
      200 &&
      (await authorizeWith(
        "https://feat-x-dashboard.example.com/api/slack/oauth/callback/next",
      )) === 200,
    "redirect_urls accept a * host wildcard and sub-paths, like Slack's matching",
  );
  assert(
    (await authorizeWith("https://evil.example.com/api/slack/oauth/callback")) === 400 &&
      (await authorizeWith("http://feat-x-dashboard.example.com/api/slack/oauth/callback")) === 400,
    "redirect URIs outside the manifest are refused",
  );

  const bot = new WebClient(access.access_token, { slackApiUrl });
  const channel = `smoke-${Date.now()}`;
  const created = await human.conversations.create({ name: channel });
  await bot.conversations.join({ channel: created.channel.id });

  const mention = await human.chat.postMessage({
    channel: created.channel.id,
    text: `<@${access.bot_user_id}> run the login tests`,
  });
  await bot.chat.postMessage({ channel: created.channel.id, thread_ts: mention.ts, text: "On it" });
  const thread = await bot.conversations.replies({ channel: created.channel.id, ts: mention.ts });
  assert(thread.messages.at(-1)?.text === "On it", "bot reply lands in the thread");

  const status = await bot.apiCall("agents.sessions.setStatus", {
    channel_id: created.channel.id,
    thread_ts: mention.ts,
    status: "processing",
  });
  assert(status.ok, "agents.sessions.setStatus succeeds");
  const unknown = await fetch(`${slackApiUrl}chat.doesNotExist`, {
    method: "POST",
    headers: { authorization: `Bearer ${access.access_token}` },
  });
  assert(
    unknown.status === 200 && (await unknown.json()).error === "unknown_method",
    "unknown methods answer 200 unknown_method like Slack",
  );

  const appMention = await waitFor(() => mentionAttempts("run the login tests")[0]);
  assert(appMention, "app_mention event is delivered");

  await human.chat.postMessage({
    channel: created.channel.id,
    text: `<@${access.bot_user_id}> fail once`,
  });
  const failed = await waitFor(
    () => mentionAttempts("fail once").length >= 2 && mentionAttempts("fail once"),
  );
  assert(
    failed &&
      failed[1].retryNum === "1" &&
      failed[1].retryReason === "http_error" &&
      failed[1].eventId === failed[0].eventId,
    "a 500 is retried with X-Slack-Retry-Num 1, reason http_error, same event_id",
  );

  const started = Date.now();
  await human.chat.postMessage({
    channel: created.channel.id,
    text: `<@${access.bot_user_id}> stall once`,
  });
  assert(
    Date.now() - started < 2000,
    "chat.postMessage returns without waiting for the event receiver",
  );
  const stalled = await waitFor(
    () => mentionAttempts("stall once").length >= 2 && mentionAttempts("stall once"),
  );
  assert(
    stalled && stalled[1].retryNum === "1" && stalled[1].retryReason === "http_timeout",
    "a receiver slower than 3s is retried with reason http_timeout",
  );

  const screenshot = randomBytes(3_000_000);
  const target = await human.files.getUploadURLExternal({
    filename: "screenshot.png",
    length: screenshot.length,
  });
  await fetch(target.upload_url, { method: "POST", body: screenshot });
  await human.files.completeUploadExternal({
    files: [{ id: target.file_id, title: "screenshot" }],
    channel_id: created.channel.id,
    initial_comment: `<@${access.bot_user_id}> what broke in this screenshot`,
  });
  const fileMention = await waitFor(() => mentionAttempts("what broke in this screenshot")[0]);
  assert(
    fileMention?.fileIds.includes(target.file_id),
    "a file shared with an @mention sends app_mention with the file",
  );
  const info = await bot.files.info({ file: target.file_id });
  assert(Boolean(info.file.thumb_360), "image files report thumbnails");
  const download = await fetch(info.file.url_private_download, {
    headers: { authorization: `Bearer ${access.access_token}` },
  });
  assert(
    Buffer.from(await download.arrayBuffer()).equals(screenshot),
    "the bot downloads the file's bytes over url_private_download",
  );

  await sleep(1000);
  assert(mentionAttempts("run the login tests").length === 1, "a 200 is not retried");
  assert(
    events.every((event) => event.valid),
    "every event carries a valid Slack signature",
  );
  const archived = await fetch(`${apiUrl}/api/worlds/${worldId}/archive`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const gone = await fetch(`${slackApiUrl}auth.test`, {
    method: "POST",
    headers: { authorization: `Bearer ${userToken}` },
  });
  assert(
    archived.status === 204 && gone.status === 404,
    "POST /api/worlds/{id}/archive takes the world offline",
  );
} finally {
  receiver.close();
}
