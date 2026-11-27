import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const apiUrl = process.env.WORLDS_API_URL ?? "http://localhost:8791";
const apiKey = process.env.WORLDS_API_KEY ?? "wk_live_smoke0smoke0smoke0smoke0smoke0smoke00";
const origin = (worldId, service) =>
  `http://${worldId.slice("world_".length)}-${service}.localhost:8787`;
const callbackUrl = "http://localhost:8793/linear/callback";
const eventsUrl = "http://localhost:8793/api/linear/events";
const run = Date.now();
const credentials = {
  client_id: `linear-smoke-${run}`,
  client_secret: `linear-smoke-secret-${run}`,
  webhook_secret: `linear-smoke-webhook-${run}`,
};
const spec = {
  workspace: { name: "Smoke", url_key: "smoke" },
  users: [
    { name: "alice", display_name: "Alice Tester", email: "alice@smoke.test" },
    { name: "bob", display_name: "Bob Tester", email: "bob@smoke.test" },
  ],
  teams: [{ key: "ENG", name: "Engineering" }],
  issues: [
    {
      team: "ENG",
      title: "A seeded issue",
      description: "Seeded before any app",
      state: "Todo",
      creator: "alice",
      comments: [{ author: "bob", body: "first!" }],
    },
  ],
  apps: [
    {
      name: "Empirical",
      callback_urls: [callbackUrl],
      scopes: ["read", "write", "app:assignable", "app:mentionable"],
      webhook_url: eventsUrl,
      credentials,
    },
  ],
};

const VIEWER_QUERY = `query Me {
  viewer { id name email avatarUrl displayName active admin createdAt updatedAt
    organization { id name urlKey logoUrl } }
  teams { nodes { id name key } }
}`;
const ISSUE_QUERY = `query Issue($id: String!) {
  issue(id: $id) { id title description url identifier createdAt updatedAt }
}`;

const deliveries = [];
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    deliveries.push({ path: req.url, headers: req.headers, raw: body, payload: JSON.parse(body) });
    res.statusCode = 200;
    res.end("ok");
  });
}).listen(8793);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

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

const form = (body) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body),
});
const control = (method, body) => ({
  method,
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const notifications = (action) =>
  deliveries.filter((delivery) => delivery.payload.action === action);

let worldId = "";
try {
  const invalid = await fetch(
    `${apiUrl}/api/worlds`,
    control("POST", {
      name: "Invalid",
      linear: {
        ...spec,
        issues: [{ team: "NOPE", title: "x", state: "Todo", creator: "alice" }],
      },
    }),
  );
  assert(
    invalid.status === 400 && (await invalid.json()).error.message.includes("unknown team NOPE"),
    "a Linear spec that names an unknown team is refused",
  );

  const created = await fetch(
    `${apiUrl}/api/worlds`,
    control("POST", { name: "Linear smoke", linear: spec }),
  );
  const world = await created.json();
  worldId = world.id;
  const app = origin(worldId, "linear");
  const api = origin(worldId, "linear-api");
  const organizationId = world.linear.spec.workspace.id;
  assert(
    created.status === 201 &&
      /^[0-9a-f-]{36}$/.test(organizationId) &&
      world.linear.spec.workspace.url === `${app}/smoke` &&
      world.linear.api_url.includes("-linear-api."),
    "POST /api/worlds creates a Linear workspace with an organization id and both hosts",
  );
  assert(
    world.linear.spec.issues[0].identifier === "ENG-1" &&
      world.linear.spec.apps[0].credentials.webhook_secret === credentials.webhook_secret,
    "the effective spec has seeded identifiers and pinned credentials",
  );

  const graphql = (token, query, variables) =>
    fetch(`${api}/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  const anonymous = await graphql(null, "{ viewer { id } }");
  const anonymousBody = await anonymous.json();
  assert(
    anonymous.status === 401 && anonymousBody.errors[0].extensions.code === "AUTHENTICATION_ERROR",
    "GraphQL without a token answers 401 AUTHENTICATION_ERROR, like api.linear.app",
  );
  const badField = await graphql("bogus", "{ viewer { nope } }");
  assert(
    badField.status === 400 &&
      (await badField.json()).errors[0].extensions.code === "GRAPHQL_VALIDATION_FAILED",
    "an invalid query fails validation before authentication",
  );

  const authorizeParams = (overrides = {}) =>
    new URLSearchParams({
      client_id: credentials.client_id,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "read,write,app:mentionable,app:assignable",
      actor: "app",
      state: "smoke-state",
      ...overrides,
    });
  const badRedirect = await fetch(
    `${app}/oauth/authorize?${authorizeParams({ redirect_uri: "https://evil.example.com/cb" })}`,
  );
  assert(badRedirect.status === 400, "authorize refuses a redirect_uri that isn't registered");
  const userActor = await fetch(`${app}/oauth/authorize?${authorizeParams({ actor: "user" })}`);
  assert(userActor.status === 400, "app:assignable needs actor=app");
  const consent = await fetch(`${app}/oauth/authorize?${authorizeParams()}`);
  const html = await consent.text();
  const aliceId = world.linear.spec.users[0].id;
  assert(
    consent.status === 200 && html.includes(`value="${aliceId}"`),
    "authorize shows a consent page listing the workspace's members",
  );
  const accepted = await fetch(`${app}/oauth/authorize`, {
    method: "POST",
    body: new URLSearchParams([...authorizeParams(), ["user_id", aliceId], ["decision", "accept"]]),
    redirect: "manual",
  });
  const location = new URL(accepted.headers.get("location"));
  const code = location.searchParams.get("code");
  assert(
    accepted.status === 302 && location.searchParams.get("state") === "smoke-state" && code,
    "authorizing redirects to the callback with a code and the state",
  );

  const exchange = await fetch(
    `${api}/oauth/token`,
    form({ grant_type: "authorization_code", ...credentials, code, redirect_uri: callbackUrl }),
  );
  const tokens = await exchange.json();
  assert(
    exchange.ok &&
      tokens.access_token.startsWith("lin_oauth_") &&
      tokens.refresh_token &&
      tokens.expires_in === 86399,
    "the code exchanges for a 24-hour access token and a refresh token",
  );
  const reused = await fetch(
    `${api}/oauth/token`,
    form({ grant_type: "authorization_code", ...credentials, code, redirect_uri: callbackUrl }),
  );
  assert(
    reused.status === 400 && (await reused.json()).error === "invalid_grant",
    "a code works once",
  );
  const wrongClient = await fetch(
    `${api}/oauth/token`,
    form({
      grant_type: "refresh_token",
      ...credentials,
      client_secret: "nope",
      refresh_token: "x",
    }),
  );
  assert(
    wrongClient.status === 400 && (await wrongClient.json()).error === "invalid_client",
    "a wrong client secret is invalid_client",
  );

  const viewer = await (await graphql(tokens.access_token, VIEWER_QUERY)).json();
  const appUserId = viewer.data?.viewer.id;
  assert(
    appUserId &&
      appUserId !== aliceId &&
      viewer.data.viewer.name === "Empirical" &&
      viewer.data.viewer.organization.id === organizationId &&
      viewer.data.viewer.organization.urlKey === "smoke" &&
      viewer.data.teams.nodes[0].key === "ENG",
    "with actor=app the viewer is the app user, in the world's organization",
  );

  const assigned = await fetch(
    `${app}/_worlds/linear/issues`,
    control("POST", {
      user: "alice",
      team: "ENG",
      title: "Checkout fails",
      description: "Steps to reproduce",
      state: "Todo",
      assignee: "Empirical",
    }),
  );
  const issue = await assigned.json();
  assert(
    assigned.status === 201 && issue.identifier === "ENG-2" && issue.assignee === appUserId,
    "a member can assign a new issue to the app",
  );
  const notification = await waitFor(() => notifications("issueAssignedToYou")[0]);
  const expected = createHmac("sha256", credentials.webhook_secret)
    .update(notification?.raw ?? "")
    .digest("hex");
  assert(
    notification?.path === "/api/linear/events" &&
      notification.headers["linear-signature"] === expected &&
      notification.headers["linear-event"] === "AppUserNotification" &&
      notification.headers["linear-delivery"] &&
      notification.headers["user-agent"] === "Linear-Webhook",
    "the app gets a signed AppUserNotification webhook",
  );
  const payload = notification.payload;
  assert(
    payload.type === "AppUserNotification" &&
      payload.organizationId === organizationId &&
      payload.oauthClientId === credentials.client_id &&
      payload.appUserId === appUserId &&
      Math.abs(Date.now() - payload.webhookTimestamp) < 60_000 &&
      payload.notification.type === "issueAssignedToYou" &&
      payload.notification.issueId === issue.id &&
      payload.notification.issue.identifier === "ENG-2" &&
      payload.notification.issue.team.key === "ENG" &&
      payload.notification.actor.email === "alice@smoke.test",
    "the payload has the organization, app user, issue with team, and actor",
  );

  const fetched = await (await graphql(tokens.access_token, ISSUE_QUERY, { id: issue.id })).json();
  assert(
    fetched.data.issue.identifier === "ENG-2" &&
      fetched.data.issue.description === "Steps to reproduce" &&
      fetched.data.issue.url.startsWith(`${app}/smoke/issue/ENG-2/`),
    "issue(id) returns the issue with its linear.app-style URL",
  );
  const missing = await (await graphql(tokens.access_token, ISSUE_QUERY, { id: "nope" })).json();
  assert(
    missing.errors[0].message === "Entity not found: Issue",
    "an unknown issue id is Entity not found",
  );
  const mutate = (query, input) => graphql(tokens.access_token, query, { input });
  const reaction = await (
    await mutate(
      `mutation ReactionCreate($input: ReactionCreateInput!) { reactionCreate(input: $input) { success } }`,
      { issueId: issue.id, emoji: "+1" },
    )
  ).json();
  const comment = await (
    await mutate(
      `mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
      { issueId: issue.id, body: "[Empirical] New request created" },
    )
  ).json();
  const attachment = (subtitle) =>
    mutate(
      `mutation AttachmentCreate($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }`,
      { issueId: issue.id, title: "Request #1", subtitle, url: "https://example.com/requests/1" },
    );
  await attachment("Open");
  const updated = await (await attachment("Done")).json();
  const state = await (await fetch(`${app}/_worlds/linear/state`, control("GET"))).json();
  const stored = state.issues.find((entry) => entry.id === issue.id);
  assert(
    reaction.data.reactionCreate.success &&
      comment.data.commentCreate.success &&
      updated.data.attachmentCreate.success &&
      stored.reactions[0].emoji === "+1" &&
      stored.comments[0].user === appUserId &&
      stored.attachments.length === 1 &&
      stored.attachments[0].subtitle === "Done",
    "the app reacts, comments as the app user and upserts its attachment by URL",
  );

  const refreshed = await (
    await fetch(
      `${api}/oauth/token`,
      form({ grant_type: "refresh_token", ...credentials, refresh_token: tokens.refresh_token }),
    )
  ).json();
  const retried = await (
    await fetch(
      `${api}/oauth/token`,
      form({ grant_type: "refresh_token", ...credentials, refresh_token: tokens.refresh_token }),
    )
  ).json();
  assert(
    refreshed.access_token &&
      refreshed.refresh_token !== tokens.refresh_token &&
      retried.access_token === refreshed.access_token &&
      retried.refresh_token === refreshed.refresh_token,
    "refresh rotates the token; retrying the old one returns the same replacement",
  );

  await fetch(
    `${app}/_worlds/linear/issues/ENG-2`,
    control("PATCH", { user: "bob", assignee: "bob" }),
  );
  const unassigned = await waitFor(() => notifications("issueUnassignedFromYou")[0]);
  assert(
    unassigned?.payload.notification.issue.identifier === "ENG-2",
    "reassigning away from the app sends issueUnassignedFromYou",
  );

  const page = await fetch(`${app}/smoke/issue/ENG-2`);
  assert(page.status === 200 || page.status === 401, "the issue page is served for members");

  const revoked = await fetch(
    `${api}/oauth/revoke`,
    form({ token: refreshed.access_token, token_type_hint: "access_token" }),
  );
  const afterRevoke = await graphql(refreshed.access_token, "{ viewer { id } }");
  const revokedAgain = await fetch(`${api}/oauth/revoke`, form({ token: refreshed.access_token }));
  assert(
    revoked.status === 200 && afterRevoke.status === 401 && revokedAgain.status === 401,
    "POST /oauth/revoke revokes the grant",
  );

  const uninstalled = await fetch(
    `${app}/_worlds/linear/apps/${credentials.client_id}/revoke`,
    control("POST"),
  );
  const oauthRevoked = await waitFor(() =>
    deliveries.find((delivery) => delivery.payload.type === "OAuthApp"),
  );
  assert(
    uninstalled.status === 204 &&
      oauthRevoked?.payload.action === "revoked" &&
      oauthRevoked.payload.organizationId === organizationId &&
      oauthRevoked.headers["linear-event"] === "OAuthApp",
    "uninstalling the app sends OAuthApp revoked",
  );

  const archived = await fetch(`${apiUrl}/api/worlds/${worldId}/archive`, control("POST"));
  const gone = await graphql(tokens.access_token, "{ viewer { id } }");
  assert(
    archived.status === 204 && gone.status === 404,
    "POST /api/worlds/{id}/archive takes the Linear workspace offline",
  );
} finally {
  receiver.close();
}
