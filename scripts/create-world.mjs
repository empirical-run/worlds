import { readFileSync } from "node:fs";

const [specPath] = process.argv.slice(2);
const apiUrl = process.env.WORLDS_API_URL ?? "https://makeworlds.dev";
const apiKey = process.env.WORLDS_API_KEY;
if (!specPath || !apiKey) {
  console.error("usage: WORLDS_API_KEY=wk_live_… node scripts/create-world.mjs specs/<name>.json");
  process.exit(1);
}

const missing = new Set();
const body = readFileSync(specPath, "utf8").replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
  const value = process.env[name];
  if (value === undefined) missing.add(name);
  return JSON.stringify(value ?? "").slice(1, -1);
});
if (missing.size) {
  console.error(`missing environment variables: ${[...missing].join(", ")}`);
  process.exit(1);
}

const response = await fetch(`${apiUrl}/api/worlds`, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body,
});
const world = await response.json();
if (!response.ok) {
  console.error(`create failed (${response.status}): ${JSON.stringify(world)}`);
  process.exit(1);
}
console.log(`world:        ${world.id}`);
console.log(`jira auth:    ${world.jira.auth_url}`);
console.log(`jira api:     ${world.jira.api_url}`);
console.log(`jira site:    ${world.jira.site_url} (cloud id ${world.jira.spec.site.cloud_id})`);
for (const app of world.jira.spec.apps)
  console.log(`jira app:     ${app.name} ${app.credentials.client_id}`);
console.log(`slack origin: ${world.slack.api_url.replace(/\/api\/$/, "")}`);
console.log(`slack ui:     ${world.slack.ui_url}`);
console.log(`team:         ${world.slack.spec.team.id}`);
for (const app of world.slack.spec.apps)
  console.log(`app:          ${app.app_id} ${app.manifest.display_information.name}`);
