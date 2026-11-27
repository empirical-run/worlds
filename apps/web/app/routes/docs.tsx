import { CodeBlock } from "../components/CodeBlock";
import { type RailHandle } from "../components/Rail";
import { highlight } from "../highlight.server";
import type { Route } from "./+types/docs";

export const meta = () => [{ title: "Docs · Worlds" }];

export const handle: RailHandle = {
  railIndex: () => [
    {
      links: [
        { id: "create", label: "Create a world" },
        { id: "base-url", label: "Point your app at a world" },
        { id: "install", label: "Install your app" },
        { id: "events", label: "Receive events" },
        { id: "worlds-api", label: "Worlds API" },
        { id: "control", label: "World controls" },
      ],
    },
  ],
};

const createExample = `curl -X POST https://makeworlds.dev/api/worlds \\
  -H "Authorization: Bearer $WORLDS_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "name": "My first world",
    "slack": {
      "apps": [{
        "manifest": {
          "display_information": { "name": "My app" },
          "oauth_config": { "scopes": { "bot": ["app_mentions:read", "chat:write"] } },
          "settings": {
            "event_subscriptions": {
              "request_url": "https://example.com/slack/events",
              "bot_events": ["app_mention"]
            }
          }
        },
        "install": true
      }]
    }
  }'`;

const webClientExample = `const client = new WebClient(token, {
  slackApiUrl: world.slack.api_url,
});`;

const curlExample = `curl https://makeworlds.dev/api/teams \\
  -H "Authorization: Bearer $WORLDS_API_KEY"`;

const clientExample = `import { createClient, type SlackSpec } from "makeworlds";

const worlds = createClient({ apiKey: process.env.WORLDS_API_KEY });

const slack: SlackSpec = {
  users: [{ name: "alice" }, { name: "bob" }],
  channels: [{ name: "general", members: ["alice", "bob"] }],
};

const { data: world, error } = await worlds.POST("/api/worlds", {
  body: { name: "My first world", slack },
});`;

export async function loader() {
  const [create, webClient, curl, install, client] = await Promise.all([
    highlight(createExample, "bash"),
    highlight(webClientExample, "ts"),
    highlight(curlExample, "bash"),
    highlight("npm install makeworlds", "bash"),
    highlight(clientExample, "ts"),
  ]);
  return { examples: { create, webClient, curl, install, client } };
}

export default function Docs({ loaderData: { examples } }: Route.ComponentProps) {
  return (
    <article>
      <header className="section hero">
        <h1>Getting started</h1>
        <p className="lede">
          Create a world, point your Slack app at it, and drive it from the UI or the API.
        </p>
      </header>

      <section className="section" id="create">
        <h2>Create a world</h2>
        <p>
          Create an API key in <a href="/settings">Settings</a>, then create a world (or create one
          on the <a href="/worlds">Worlds</a> page). Each world is separate and keeps its state
          until you archive it.
        </p>
        <CodeBlock lines={examples.create} />
        <p>
          The <code>slack</code> spec describes everything in the workspace: the team, users,
          channels with their members and messages, and apps defined by standard Slack app
          manifests. Ids, credentials and tokens you leave out are generated; pin them (a team id, a
          user token, an app's client secret or a bot token) to match what your app already stores.
          Without a spec the world gets one user, alice, and #general.
        </p>
        <p>
          The response has the world's Slack URLs (<code>slack.api_url</code>,{" "}
          <code>slack.oauth_authorize_url</code>, <code>slack.ui_url</code>) and{" "}
          <code>slack.spec</code>: the spec with everything generated filled in, also at{" "}
          <code>GET /api/worlds/:id/spec</code>. A world never changes its spec; to change it,
          create a new world. Worlds are cheap.
        </p>
      </section>

      <section className="section" id="base-url">
        <h2>Point your app at a world</h2>
        <p>
          Use the world's <code>slack.api_url</code> as your Slack base URL. With{" "}
          <code>@slack/web-api</code>:
        </p>
        <CodeBlock lines={examples.webClient} />
      </section>

      <section className="section" id="install">
        <h2>Install your app</h2>
        <p>
          Apps with <code>install: true</code> are installed already. Otherwise send users to the
          world's <code>slack.oauth_authorize_url</code> instead of slack.com. Redirect URIs match
          the manifest's <code>redirect_urls</code> the way Slack matches them (same scheme, host
          and port; the path equal or below). Worlds also accepts a <code>*</code> in the host, such
          as <code>https://*-preview.example.com/oauth/callback</code>, for preview deployments.{" "}
          <code>oauth.v2.access</code> exchanges the code for a bot token as usual.
        </p>
        <p>
          <code>apps.manifest.export</code> and <code>validate</code> work as on Slack.{" "}
          <code>create</code>, <code>update</code> and <code>delete</code> answer{" "}
          <code>restricted_action</code>: a world's apps come from its spec.
        </p>
      </section>

      <section className="section" id="events">
        <h2>Receive events</h2>
        <p>
          The world posts the events your manifest subscribes to (
          <code>settings.event_subscriptions.bot_events</code>) to its <code>request_url</code>,
          signed with the app's signing secret, for every app installed in the world. A non-2xx
          response, a connection failure or no answer within 3 seconds is retried with{" "}
          <code>X-Slack-Retry-Num</code> right away, after 1 minute and after 5 minutes.
        </p>
      </section>

      <section className="section" id="jira">
        <h2>Jira</h2>
        <p>
          Every world also has a Jira Cloud site. The <code>jira</code> spec describes its users,
          projects, issues and OAuth 2.0 (3LO) apps (name, <code>callback_urls</code>,{" "}
          <code>scopes</code>, optional pinned <code>credentials</code>). Like Atlassian, the site
          answers on three hosts, returned as <code>jira.auth_url</code> (in place of
          auth.atlassian.com), <code>jira.api_url</code> (api.atlassian.com) and{" "}
          <code>jira.site_url</code> (your-site.atlassian.net). Point your app's two Atlassian base
          URLs at the first two; it learns the site URL and cloud id from{" "}
          <code>/oauth/token/accessible-resources</code>, as it would in production.
        </p>
        <p>
          Supported: <code>/authorize</code> (a consent page where you pick the user),{" "}
          <code>/oauth/token</code> with rotating refresh tokens, and under{" "}
          <code>/ex/jira/{"{cloudId}"}/rest/api/3</code>: <code>GET issue</code>,{" "}
          <code>POST issue/{"{key}"}/comment</code>, <code>GET user</code>, <code>GET myself</code>{" "}
          and dynamic webhooks (<code>GET/POST/DELETE webhook</code>,{" "}
          <code>PUT webhook/refresh</code>). Webhook JQL supports <code>labels</code>,{" "}
          <code>project</code>, <code>status</code>, <code>issuekey</code>, <code>assignee</code>{" "}
          and <code>reporter</code> with <code>=</code>, <code>!=</code>, <code>in</code> and{" "}
          <code>not in</code>, joined by <code>AND</code>. Deliveries are signed with a JWT (HS256,
          the app's client secret) and retried up to 5 times, 5 to 15 minutes apart, on 408, 409,
          425, 429, 5xx or no answer within 10 seconds.
        </p>
      </section>

      <section className="section" id="worlds-api">
        <h2>Worlds API</h2>
        <p>
          Create an API key in <a href="/settings">Settings</a> and send it as{" "}
          <code>Authorization: Bearer &lt;key&gt;</code>.
        </p>
        <CodeBlock lines={examples.curl} />
        <p>
          Every endpoint is in the <a href="/docs/api">API reference</a>, generated from{" "}
          <a href="/api/openapi.json">
            <code>/api/openapi.json</code>
          </a>
          .
        </p>
        <p>
          From TypeScript, the <code>makeworlds</code> package is a typed client for the same API
          (built on <code>openapi-fetch</code>), with types for every request and response,
          including world specs (<code>WorldCreate</code>, <code>SlackSpec</code>,{" "}
          <code>SlackState</code>).
        </p>
        <CodeBlock lines={examples.install} />
        <CodeBlock lines={examples.client} />
      </section>

      <section className="section" id="control">
        <h2>World controls</h2>
        <p>
          These routes live under the world's URL and take your team's API key as{" "}
          <code>Authorization: Bearer &lt;key&gt;</code>, or your makeworlds.dev session.
        </p>
        <ul>
          <li>
            <code>POST /_worlds/slack/tokens</code> returns a user token for{" "}
            <code>{'{"user_id"}'}</code>, to act as that user with any Slack client.
          </li>
          <li>
            <code>GET /_worlds/slack/state</code> returns users, channels and messages.
          </li>
          <li>
            <code>POST /_worlds/slack/act</code> calls a Web API method as a user, e.g. to post an
            @mention.
          </li>
          <li>
            On the Jira site host, <code>POST /_worlds/jira/issues</code> creates an issue as a user
            (<code>{'{"user", "summary", "description", "labels", "status", "assignee"}'}</code>),{" "}
            <code>PATCH /_worlds/jira/issues/:key</code> changes it, <code>DELETE</code> removes it
            and <code>POST /_worlds/jira/issues/:key/comments</code> comments. Each sends the
            webhooks Jira would. <code>GET /_worlds/jira/state</code> returns the spec, issues and
            webhooks; the site's <code>/</code> and <code>/browse/:key</code> show issues and
            comments.
          </li>
        </ul>
        <p>
          Archive a world with <code>POST /api/worlds/:id/archive</code>. Archiving takes it offline
          for good.
        </p>
      </section>
    </article>
  );
}
