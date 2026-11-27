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

export async function loader() {
  const [create, webClient, curl] = await Promise.all([
    highlight(createExample, "bash"),
    highlight(webClientExample, "ts"),
    highlight(curlExample, "bash"),
  ]);
  return { examples: { create, webClient, curl } };
}

export default function Docs({ loaderData: { examples } }: Route.ComponentProps) {
  return (
    <article>
      <header className="section hero">
        <h1>Getting started</h1>
        <p className="lede">Create a world, point your Slack app at it, and drive it from the UI or the API.</p>
      </header>

      <section className="section" id="create">
        <h2>Create a world</h2>
        <p>
          Create an API key in <a href="/settings">Settings</a>, then create a world (or create one on the <a href="/worlds">Worlds</a> page). Each world is separate and keeps its state until
          you archive it.
        </p>
        <CodeBlock lines={examples.create} />
        <p>
          The <code>slack</code> spec describes everything in the workspace: the team, users, channels with their members and messages, and
          apps defined by standard Slack app manifests. Ids, credentials and tokens you leave out are generated; pin them (a team id, a user
          token, an app's client secret or a bot token) to match what your app already stores. Without a spec the world gets one user, alice,
          and #general.
        </p>
        <p>
          The response has the world's Slack URLs (<code>slack.api_url</code>, <code>slack.oauth_authorize_url</code>,{" "}
          <code>slack.ui_url</code>) and <code>slack.spec</code>: the spec with everything generated filled in, also at{" "}
          <code>GET /api/worlds/:id/spec</code>. A world never changes its spec; to change it, create a new world. Worlds are cheap.
        </p>
      </section>

      <section className="section" id="base-url">
        <h2>Point your app at a world</h2>
        <p>
          Use the world's <code>slack.api_url</code> as your Slack base URL. With <code>@slack/web-api</code>:
        </p>
        <CodeBlock lines={examples.webClient} />
      </section>

      <section className="section" id="install">
        <h2>Install your app</h2>
        <p>
          Apps with <code>install: true</code> are installed already. Otherwise send users to the world's <code>slack.oauth_authorize_url</code>{" "}
          instead of slack.com. Redirect URIs match the manifest's <code>redirect_urls</code> the way Slack matches them (same scheme, host and
          port; the path equal or below). Worlds also accepts a <code>*</code> in the host, such as{" "}
          <code>https://*-preview.example.com/oauth/callback</code>, for preview deployments. <code>oauth.v2.access</code> exchanges the code
          for a bot token as usual.
        </p>
        <p>
          <code>apps.manifest.export</code> and <code>validate</code> work as on Slack. <code>create</code>, <code>update</code> and{" "}
          <code>delete</code> answer <code>restricted_action</code>: a world's apps come from its spec.
        </p>
      </section>

      <section className="section" id="events">
        <h2>Receive events</h2>
        <p>
          The world posts the events your manifest subscribes to (<code>settings.event_subscriptions.bot_events</code>) to its{" "}
          <code>request_url</code>, signed with the app's signing secret, for every app installed in the world. A non-2xx response, a connection failure or
          no answer within 3 seconds is retried with <code>X-Slack-Retry-Num</code> right away, after 1 minute and after 5 minutes.
        </p>
      </section>

      <section className="section" id="worlds-api">
        <h2>Worlds API</h2>
        <p>
          Create an API key in <a href="/settings">Settings</a> and send it as <code>Authorization: Bearer &lt;key&gt;</code>.
        </p>
        <CodeBlock lines={examples.curl} />
        <p>
          Every endpoint is in the <a href="/docs/api">API reference</a>, generated from{" "}
          <a href="/api/openapi.json">
            <code>/api/openapi.json</code>
          </a>
          .
        </p>
      </section>

      <section className="section" id="control">
        <h2>World controls</h2>
        <p>
          These routes live under the world's URL and take your team's API key as <code>Authorization: Bearer &lt;key&gt;</code>, or your
          makeworlds.dev session.
        </p>
        <ul>
          <li>
            <code>POST /_worlds/slack/tokens</code> returns a user token for <code>{'{"user_id"}'}</code>, to act as that user with any Slack
            client.
          </li>
          <li>
            <code>GET /_worlds/slack/state</code> returns users, channels and messages.
          </li>
          <li>
            <code>POST /_worlds/slack/act</code> calls a Web API method as a user, e.g. to post an @mention.
          </li>
        </ul>
        <p>
          Archive a world with <code>POST /api/worlds/:id/archive</code>. Archiving takes it offline for good.
        </p>
      </section>
    </article>
  );
}
