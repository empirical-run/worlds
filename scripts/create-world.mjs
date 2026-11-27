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
  if (value === undefined) {
    missing.add(name);
  }
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
console.log(`world: ${world.id}`);
console.log(`ui:    ${world.ui_url}`);
for (const [name, service] of Object.entries(world)) {
  if (typeof service !== "object" || service === null || !("spec" in service)) {
    continue;
  }
  const { spec, ...urls } = service;
  for (const [key, url] of Object.entries(urls)) {
    console.log(`${name} ${key}: ${url}`);
  }
  for (const app of spec.apps ?? []) {
    console.log(`${name} app: ${app.app_id ?? app.name} (client id ${app.credentials.client_id})`);
  }
}
