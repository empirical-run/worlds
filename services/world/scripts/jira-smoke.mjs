import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const apiUrl = process.env.WORLDS_API_URL ?? "http://localhost:8791";
const apiKey = process.env.WORLDS_API_KEY ?? "wk_live_smoke0smoke0smoke0smoke0smoke0smoke00";
const origin = (worldId, service) => `http://${worldId.slice("world_".length)}-${service}.localhost:8787`;
const callbackUrl = "http://localhost:8789/jira/callback";
const eventsUrl = "http://localhost:8789/api/jira/events";
const run = Date.now();
const credentials = { client_id: `jira-smoke-${run}`, client_secret: `jira-smoke-secret-${run}` };
const scopes = "read:jira-work write:jira-work read:jira-user manage:jira-webhook offline_access";
const spec = {
  site: { name: "smoke" },
  users: [{ name: "alice", display_name: "Alice Tester" }, { name: "bob", display_name: "Bob Tester", hide_email: true }],
  projects: [{ key: "WRLD", name: "Worlds" }],
  issues: [{ project: "WRLD", summary: "A seeded issue", description: "Seeded before any app", labels: ["seed"], comments: [{ author: "bob", body: "first!" }] }],
  apps: [{ name: "Smoke", callback_urls: ["http://localhost:8789/jira/callback"], credentials }],
};

const deliveries = [];
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    deliveries.push({ path: req.url, headers: req.headers, payload: JSON.parse(body || "{}") });
    res.end("ok");
  });
}).listen(8789);

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

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

function jwtValid(authorization, secret) {
  const [header, payload, signature] = (authorization ?? "").replace(/^Bearer /, "").split(".");
  if (!header || !payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const control = (method, body) => ({ method, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const bearer = (token, init = {}) => ({ ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json", ...init.headers } });
const events = (name) => deliveries.filter((delivery) => delivery.payload.webhookEvent === name);

let worldId = "";
try {
  const invalid = await fetch(`${apiUrl}/api/worlds`, control("POST", { jira: { projects: [{ key: "WRLD" }], issues: [{ project: "NOPE", summary: "x" }] } }));
  assert(invalid.status === 400, "a Jira spec that names an unknown project is refused");

  const created = await fetch(`${apiUrl}/api/worlds`, control("POST", { name: "Jira smoke", jira: spec }));
  const world = await created.json();
  worldId = world.id;
  const site = origin(worldId, "jira");
  const auth = origin(worldId, "jira-auth");
  const api = origin(worldId, "jira-api");
  const cloudId = world.jira.spec.site.cloud_id;
  assert(created.status === 201 && /^[0-9a-f-]{36}$/.test(cloudId) && world.jira.spec.site.url === site, "POST /api/worlds seeds a Jira site with a random cloud id");
  assert(world.jira.spec.issues[0].key === "WRLD-1" && world.jira.spec.apps[0].credentials.client_id === credentials.client_id, "the effective Jira spec has seeded issue keys and pinned credentials");
  const exported = await (await fetch(`${apiUrl}/api/worlds/${worldId}/spec`, control("GET"))).json();
  assert(exported.jira.site.cloud_id === cloudId, "GET /api/worlds/{id}/spec includes the Jira spec");

  const authorizeParams = (overrides = {}) =>
    new URLSearchParams({ audience: "api.atlassian.com", client_id: credentials.client_id, scope: scopes, redirect_uri: callbackUrl, state: "smoke-state", response_type: "code", prompt: "consent", ...overrides });
  const badRedirect = await fetch(`${auth}/authorize?${authorizeParams({ redirect_uri: "https://evil.example.com/jira/callback" })}`);
  assert(badRedirect.status === 400, "authorize refuses a redirect_uri that isn't a callback URL");
  const badScope = await fetch(`${auth}/authorize?${authorizeParams({ scope: "read:jira-work manage:jira-project" })}`);
  assert(badScope.status === 400, "authorize refuses scopes the app wasn't given");
  const consent = await fetch(`${auth}/authorize?${authorizeParams()}`);
  const html = await consent.text();
  const aliceId = world.jira.spec.users[0].account_id;
  assert(consent.status === 200 && html.includes(`value="${aliceId}"`), "authorize shows a consent page listing the world's users");
  const form = new URLSearchParams([...authorizeParams(), ["account_id", aliceId], ["decision", "accept"]]);
  const accepted = await fetch(`${auth}/authorize`, { method: "POST", body: form, redirect: "manual" });
  const location = new URL(accepted.headers.get("location"));
  const code = location.searchParams.get("code");
  assert(accepted.status === 302 && location.origin + location.pathname === callbackUrl && location.searchParams.get("state") === "smoke-state" && code, "accepting redirects to the callback with a code and the state");

  const exchange = await fetch(`${auth}/oauth/token`, json({ grant_type: "authorization_code", ...credentials, code, redirect_uri: callbackUrl }));
  const tokens = await exchange.json();
  assert(exchange.ok && tokens.access_token && tokens.refresh_token && tokens.expires_in === 3600, "the code exchanges for access and refresh tokens");
  const reused = await fetch(`${auth}/oauth/token`, json({ grant_type: "authorization_code", ...credentials, code, redirect_uri: callbackUrl }));
  assert(reused.status === 403 && (await reused.json()).error === "invalid_grant", "a code works once");
  const wrongSecret = await fetch(`${auth}/oauth/token`, json({ grant_type: "authorization_code", client_id: credentials.client_id, client_secret: "nope", code, redirect_uri: callbackUrl }));
  assert(wrongSecret.status === 401, "a wrong client secret is refused");

  const resources = await (await fetch(`${api}/oauth/token/accessible-resources`, bearer(tokens.access_token))).json();
  assert(resources.length === 1 && resources[0].id === cloudId && resources[0].url === site, "accessible-resources lists the world's site");
  const onAuthHost = await fetch(`${auth}/oauth/token/accessible-resources`, bearer(tokens.access_token));
  assert(onAuthHost.status === 404, "accessible-resources is only on the API host");
  const onSite = await fetch(`${site}/rest/api/3/issue/WRLD-1`, bearer(tokens.access_token));
  assert(onSite.status === 401, "the site host refuses OAuth tokens, like *.atlassian.net");
  const rest = `${api}/ex/jira/${cloudId}/rest/api/3`;
  const wrongCloud = await fetch(`${api}/ex/jira/00000000-0000-0000-0000-000000000000/rest/api/3/issue/WRLD-1`, bearer(tokens.access_token));
  assert(wrongCloud.status === 404, "another cloud id is not found");
  const noToken = await fetch(`${rest}/issue/WRLD-1`);
  assert(noToken.status === 401, "REST needs a token");

  const seeded = await (await fetch(`${rest}/issue/WRLD-1`, bearer(tokens.access_token))).json();
  assert(seeded.key === "WRLD-1" && seeded.fields.description.type === "doc" && seeded.fields.comment.total === 1, "GET issue returns v3 JSON with an ADF description and comments");
  const alice = await (await fetch(`${rest}/user?accountId=${aliceId}`, bearer(tokens.access_token))).json();
  const bob = await (await fetch(`${rest}/user?accountId=${world.jira.spec.users[1].account_id}`, bearer(tokens.access_token))).json();
  assert(alice.emailAddress === world.jira.spec.users[0].email && bob.displayName === "Bob Tester" && !("emailAddress" in bob), "GET user hides emailAddress when the user hides it");

  const register = await (await fetch(`${rest}/webhook`, bearer(tokens.access_token, { method: "POST", body: JSON.stringify({ url: eventsUrl, webhooks: [{ jqlFilter: 'labels = "empirical"', events: ["jira:issue_created", "jira:issue_updated", "jira:issue_deleted", "comment_created"] }] }) }))).json();
  const webhookId = register.webhookRegistrationResult[0].createdWebhookId;
  assert(typeof webhookId === "number", "POST webhook registers a dynamic webhook");
  const secondUrl = await (await fetch(`${rest}/webhook`, bearer(tokens.access_token, { method: "POST", body: JSON.stringify({ url: "http://localhost:8789/other", webhooks: [{ jqlFilter: "project = WRLD", events: ["jira:issue_created"] }] }) }))).json();
  assert(secondUrl.webhookRegistrationResult[0].errors[0].startsWith("Only a single URL per user"), "a second URL for the same user is refused");
  const badJql = await (await fetch(`${rest}/webhook`, bearer(tokens.access_token, { method: "POST", body: JSON.stringify({ url: eventsUrl, webhooks: [{ jqlFilter: "text ~ checkout", events: ["jira:issue_created"] }] }) }))).json();
  assert(Boolean(badJql.webhookRegistrationResult[0].errors), "unsupported JQL is refused");
  const listed = await (await fetch(`${rest}/webhook`, bearer(tokens.access_token))).json();
  assert(listed.total === 1 && listed.values[0].url === eventsUrl && listed.values[0].expirationDate > Date.now(), "GET webhook lists it with url and expiry");

  const labelled = await (await fetch(`${site}/_worlds/jira/issues`, control("POST", { user: "bob", summary: "Add a checkout test", description: "Cover guest checkout", labels: ["empirical"] }))).json();
  const createdEvent = await waitFor(() => events("jira:issue_created")[0]);
  assert(createdEvent?.path === "/api/jira/events" && createdEvent.payload.issue.key === labelled.key && createdEvent.payload.issue_event_type_name === "issue_created", "creating a labelled issue sends jira:issue_created");
  assert(jwtValid(createdEvent.headers.authorization, credentials.client_secret), "the delivery carries a JWT signed with the app's client secret");
  assert(new URL(createdEvent.payload.issue.self).origin === site && createdEvent.payload.issue.fields.description === "Cover guest checkout", "webhook issues are v2 JSON on the site host");
  assert(createdEvent.payload.user.displayName === "Bob Tester" && createdEvent.payload.matchedWebhookIds[0] === webhookId, "the payload names the actor and the matched webhook");

  const plain = await (await fetch(`${site}/_worlds/jira/issues`, control("POST", { user: "alice", summary: "Unrelated" }))).json();
  await sleep(500);
  assert(events("jira:issue_created").length === 1, "an issue outside the JQL sends nothing");
  await fetch(`${site}/_worlds/jira/issues/${plain.key}`, control("PATCH", { user: "alice", labels: ["empirical"] }));
  const updated = await waitFor(() => events("jira:issue_updated")[0]);
  const labelsItem = updated?.payload.changelog.items.find((item) => item.field === "labels");
  assert(updated?.payload.issue.key === plain.key && labelsItem?.fromString === "" && labelsItem?.toString === "empirical", "adding the label sends jira:issue_updated with a labels changelog");

  const comment = await fetch(`${rest}/issue/${labelled.key}/comment`, bearer(tokens.access_token, { method: "POST", body: JSON.stringify({ body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "[Empirical] New request created: " }, { type: "text", text: "Request #1", marks: [{ type: "link", attrs: { href: "https://example.com/r/1" } }] }] }] } }) }));
  assert(comment.status === 201, "POST comment with an ADF body is created");
  const badComment = await fetch(`${rest}/issue/${labelled.key}/comment`, bearer(tokens.access_token, { method: "POST", body: JSON.stringify({ body: "plain text" }) }));
  assert(badComment.status === 400, "a comment body that isn't ADF is refused");
  const commentEvent = await waitFor(() => events("comment_created")[0]);
  assert(commentEvent?.payload.comment.body.includes("[Request #1|https://example.com/r/1]"), "the comment sends comment_created with a wiki-markup body");
  const page = await fetch(`${site}/browse/${labelled.key}`, control("GET"));
  assert(page.status === 200 && (await page.text()).includes("Request #1"), "the site shows the issue and its comments to the world's team");
  assert((await fetch(`${site}/browse/${labelled.key}`)).status === 401, "the site needs a world team member");

  const refreshed = await (await fetch(`${auth}/oauth/token`, json({ grant_type: "refresh_token", ...credentials, refresh_token: tokens.refresh_token }))).json();
  assert(refreshed.access_token && refreshed.refresh_token && refreshed.refresh_token !== tokens.refresh_token, "refreshing rotates the refresh token");
  const reusedRefresh = await fetch(`${auth}/oauth/token`, json({ grant_type: "refresh_token", ...credentials, refresh_token: tokens.refresh_token }));
  assert(reusedRefresh.ok, "the old refresh token still works inside the reuse window");
  const unknownRefresh = await fetch(`${auth}/oauth/token`, json({ grant_type: "refresh_token", ...credentials, refresh_token: "nope" }));
  assert(unknownRefresh.status === 403 && (await unknownRefresh.json()).error === "unauthorized_client", "an unknown refresh token is unauthorized_client");

  const extended = await (await fetch(`${rest}/webhook/refresh`, bearer(refreshed.access_token, { method: "PUT", body: JSON.stringify({ webhookIds: [webhookId] }) }))).json();
  assert(extended.expirationDate > Date.now() + 29 * 24 * 3600 * 1000, "PUT webhook/refresh extends it by 30 days");
  await fetch(`${site}/_worlds/jira/issues/${labelled.key}?user=alice`, control("DELETE"));
  const deletedEvent = await waitFor(() => events("jira:issue_deleted")[0]);
  assert(deletedEvent?.payload.issue.key === labelled.key, "deleting an issue sends jira:issue_deleted");
  const removed = await fetch(`${rest}/webhook`, bearer(refreshed.access_token, { method: "DELETE", body: JSON.stringify({ webhookIds: [webhookId] }) }));
  const afterDelete = await (await fetch(`${rest}/webhook`, bearer(refreshed.access_token))).json();
  assert(removed.status === 202 && afterDelete.total === 0, "DELETE webhook removes it");
  assert(deliveries.every((delivery) => jwtValid(delivery.headers.authorization, credentials.client_secret) && delivery.headers["x-atlassian-webhook-identifier"]), "every delivery is signed and identified");

  const archived = await fetch(`${apiUrl}/api/worlds/${worldId}/archive`, control("POST"));
  const gone = await fetch(`${api}/oauth/token/accessible-resources`, bearer(refreshed.access_token));
  assert(archived.status === 204 && gone.status === 404, "POST /api/worlds/{id}/archive takes the Jira site offline");
} finally {
  receiver.close();
}
