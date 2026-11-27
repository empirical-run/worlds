import { RailIndex, type RailHandle } from "../components/Rail";

export const meta = () => [{ title: "Docs · Worlds" }];

export const handle: RailHandle = {
  railIndex: () => (
    <RailIndex heading="Getting started">
      <a href="#create">Create a world</a>
      <a href="#base-url">Point your app at a world</a>
      <a href="#install">Install your app</a>
      <a href="#events">Receive events</a>
      <a href="#worlds-api">Worlds API</a>
      <a href="/docs/api">API reference</a>
      <a href="#control">World controls</a>
    </RailIndex>
  ),
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

export default function Docs() {
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
          you delete it.
        </p>
        <pre>
          <code>{createExample}</code>
        </pre>
        <p>
          The response has the world's Slack URLs (<code>slack.api_url</code>, <code>slack.oauth_authorize_url</code>,{" "}
          <code>slack.ui_url</code>) and, for each app, its credentials and, with <code>install</code>, a bot token. Apps are defined by a
          standard Slack app manifest. Pass <code>credentials</code> to pin a client id, client secret or signing secret your app already
          uses.
        </p>
      </section>

      <section className="section" id="base-url">
        <h2>Point your app at a world</h2>
        <p>
          Use the world's <code>slack.api_url</code> as your Slack base URL. With <code>@slack/web-api</code>:
        </p>
        <pre>
          <code>{webClientExample}</code>
        </pre>
      </section>

      <section className="section" id="install">
        <h2>Install your app</h2>
        <p>
          Apps with <code>install: true</code> are installed already. Otherwise send users to the world's <code>slack.oauth_authorize_url</code>{" "}
          instead of slack.com: redirect URIs must be in the manifest's <code>redirect_urls</code>, and <code>oauth.v2.access</code> exchanges
          the code for a bot token as usual.
        </p>
        <p>
          To change apps later, call <code>apps.manifest.create</code>, <code>update</code>, <code>export</code>, <code>delete</code> or{" "}
          <code>validate</code> on the world's API URL with your team's API key as the configuration token.
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
        <pre>
          <code>{curlExample}</code>
        </pre>
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
            <code>POST /_worlds/slack/apps</code> creates an app from <code>{'{"manifest", "credentials", "install"}'}</code>, like the
            create-world option.
          </li>
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
          Delete a world with <code>DELETE /api/worlds/:id</code>.
        </p>
      </section>
    </article>
  );
}
