import { execFileSync } from "node:child_process";

import { WebClient } from "@slack/web-api";

const apiUrl = process.env.WORLDS_API_URL ?? "https://makeworlds.dev";
const apiKey = process.env.WORLDS_API_KEY;
const worldId = process.env.WORLD_ID;
const appName = process.env.WORLDS_SLACK_APP ?? "Empirical";
const actor = process.env.WORLDS_SLACK_USER ?? "alice";
const redirectUri =
  process.env.WORLDS_SLACK_REDIRECT_URI ?? "http://localhost:3000/api/slack/oauth/callback";
const orgId = Number(process.env.EMPIRICAL_ORG_ID ?? 3);
const projectSlug = process.env.EMPIRICAL_PROJECT_SLUG ?? "lorem-ipsum";
const apiWorkerUrl = process.env.EMPIRICAL_API_WORKER_URL ?? "https://api-preview.empirical.run";
if (!apiKey || !worldId) {
  console.error(
    "usage: WORLDS_API_KEY=wk_live_… WORLD_ID=world_… node scripts/preview-mention.mjs",
  );
  process.exit(1);
}

function step(message) {
  console.log(`→ ${message}`);
}

async function worlds(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const world = await worlds(`${apiUrl}/api/worlds/${worldId}`);
const spec = await worlds(`${apiUrl}/api/worlds/${worldId}/spec`);
const base = new URL(world.slack.ui_url).origin;
const slackApiUrl = world.slack.api_url;
const app = spec.slack.apps.find(
  (candidate) => candidate.manifest.display_information.name === appName,
);
if (!app) throw new Error(`no app named ${appName} in ${worldId}`);
const scope = (app.manifest.oauth_config?.scopes?.bot ?? []).join(",");
const { user_id: userId, token: userToken } = await worlds(`${base}/_worlds/slack/tokens`, {
  method: "POST",
  body: JSON.stringify({ user: actor }),
});
step(`acting as ${actor} (${userId}) in ${worldId}`);

async function authorizeCode() {
  const callback = await fetch(`${base}/oauth/v2/authorize/callback`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({
      user_id: userId,
      client_id: app.credentials.client_id,
      redirect_uri: redirectUri,
      scope,
      state: "preview",
    }),
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
    {
      input: JSON.stringify({ org_id: orgId, code, redirect_uri: redirectUri }),
      env: {
        ...process.env,
        EMPIRICAL_ENV: "local",
        EMPIRICAL_API_WORKER_URL: apiWorkerUrl,
        DO_NOT_TRACK: "1",
      },
      encoding: "utf8",
    },
  );
  const install = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
  if (!install.success) throw new Error(`install failed: ${output}`);
  return install.data;
}

const install = installOnEmpirical(await authorizeCode());
step(
  `installed on ${apiWorkerUrl}: team ${install.team_id}, bot ${install.bot_user_id}, org ${install.org_id}`,
);

const human = new WebClient(userToken, { slackApiUrl });
const channel = (await human.conversations.create({ name: `mention-${Date.now()}` })).channel;
await human.conversations.invite({ channel: channel.id, users: install.bot_user_id });
step(`#${channel.name} created with the bot invited`);

const mention = await human.chat.postMessage({
  channel: channel.id,
  text: `<@${install.bot_user_id}> [${projectSlug}] Say hello and list the test files in this repo. Do not change anything.`,
});
step(`${actor} mentioned the bot (ts ${mention.ts}); waiting for a reply`);

const deadline = Date.now() + 180_000;
let botReplies = [];
while (Date.now() < deadline) {
  const thread = await human.conversations.replies({ channel: channel.id, ts: mention.ts });
  botReplies = thread.messages.filter(
    (message) => message.user === install.bot_user_id || message.bot_id,
  );
  if (botReplies.length) break;
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!botReplies.length) throw new Error("no bot reply within 3 minutes");
for (const reply of botReplies) console.log(`  bot: ${reply.text}`);
console.log(`world UI: ${base}/?channel=${channel.id}`);
