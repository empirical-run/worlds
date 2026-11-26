import { execFileSync } from "node:child_process";
import { WebClient } from "@slack/web-api";

const base = process.env.WORLDS_URL;
const adminToken = process.env.WORLDS_ADMIN_TOKEN;
const userToken = process.env.WORLDS_SLACK_USER_TOKEN;
const clientId = process.env.WORLDS_SLACK_CLIENT_ID;
const orgId = Number(process.env.EMPIRICAL_ORG_ID ?? 3);
const projectSlug = process.env.EMPIRICAL_PROJECT_SLUG ?? "lorem-ipsum";
const apiWorkerUrl = process.env.EMPIRICAL_API_WORKER_URL ?? "https://api-preview.empirical.run";
const redirectUri = `${base}/oauth/done`;
const slackApiUrl = `${base}/api/`;
const scope = "app_mentions:read,chat:write,channels:history,channels:read,users:read";

function step(message) {
  console.log(`→ ${message}`);
}

async function admin(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
}

async function authorizeCode() {
  const query = new URLSearchParams({ client_id: clientId, scope, redirect_uri: redirectUri, state: "preview" });
  const html = await (await fetch(`${base}/oauth/v2/authorize?${query}`)).text();
  const userIds = [...html.matchAll(/name="user_id"[^>]*value="([^"]+)"/g)].map((match) => match[1]);
  const alice = (await new WebClient(userToken, { slackApiUrl }).auth.test()).user_id;
  const userId = userIds.includes(alice) ? alice : userIds[0];
  const callback = await fetch(`${base}/oauth/v2/authorize/callback`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ user_id: userId, client_id: clientId, redirect_uri: redirectUri, scope, state: "preview" }),
  });
  const location = callback.headers.get("location");
  const code = location && new URL(location).searchParams.get("code");
  if (!code) throw new Error(`no OAuth code: ${callback.status} ${location}`);
  return code;
}

function installOnEmpirical(code) {
  const output = execFileSync(
    "empirical",
    ["api", "api/slack/installations", "-X", "POST", "--input", "-"],
    { input: JSON.stringify({ org_id: orgId, code, redirect_uri: redirectUri }), env: { ...process.env, EMPIRICAL_ENV: "local", EMPIRICAL_API_WORKER_URL: apiWorkerUrl, DO_NOT_TRACK: "1" }, encoding: "utf8" },
  );
  const install = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
  if (!install.success) throw new Error(`install failed: ${output}`);
  return install.data;
}

await admin("/_worlds/slack/redirect-uris", { redirect_uri: redirectUri });
step("redirect URI registered on the twin");

const install = installOnEmpirical(await authorizeCode());
step(`installed on ${apiWorkerUrl}: team ${install.team_id}, bot ${install.bot_user_id}, org ${install.org_id}`);

const alice = new WebClient(userToken, { slackApiUrl });
const channel = (await alice.conversations.create({ name: `mention-${Date.now()}` })).channel;
await alice.conversations.invite({ channel: channel.id, users: install.bot_user_id });
step(`#${channel.name} created with the bot invited`);

const mention = await alice.chat.postMessage({
  channel: channel.id,
  text: `<@${install.bot_user_id}> [${projectSlug}] Say hello and list the test files in this repo. Do not change anything.`,
});
step(`Alice mentioned the bot (ts ${mention.ts}); waiting for a reply`);

const deadline = Date.now() + 180_000;
let botReplies = [];
while (Date.now() < deadline) {
  const thread = await alice.conversations.replies({ channel: channel.id, ts: mention.ts });
  botReplies = thread.messages.filter((message) => message.user === install.bot_user_id || message.bot_id);
  if (botReplies.length) break;
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!botReplies.length) throw new Error("no bot reply within 3 minutes");
for (const reply of botReplies) console.log(`  bot: ${reply.text}`);
console.log(`twin UI: ${base}/?tab=messages&channel=${channel.id}`);
