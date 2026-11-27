# makeworlds

A typed client for the [Worlds](https://makeworlds.dev) API: hosted, stateful worlds of the services your app depends on (Slack first), for testing apps and agents end to end.

```bash
npm install makeworlds
```

```ts
import { createClient, type SlackSpec } from "makeworlds";

const worlds = createClient({ apiKey: process.env.WORLDS_API_KEY });

const slack: SlackSpec = {
  users: [{ name: "alice" }, { name: "bob" }],
  channels: [
    {
      name: "general",
      members: ["alice", "bob"],
      messages: [{ user: "alice", text: "Deploy failed on main" }],
    },
  ],
  apps: [
    {
      manifest: {
        display_information: { name: "My app" },
        oauth_config: { scopes: { bot: ["app_mentions:read", "chat:write"] } },
        settings: {
          event_subscriptions: {
            request_url: "https://example.com/slack/events",
            bot_events: ["app_mention"],
          },
        },
      },
      install: true,
    },
  ],
};

const { data: world, error } = await worlds.POST("/api/worlds", {
  body: { name: "Thread routing eval", slack },
});
if (error) throw new Error(error.error.message);

world.slack.api_url;
world.slack.spec.apps[0].install?.bot_token;

await worlds.POST("/api/worlds/{worldId}/archive", { params: { path: { worldId: world.id } } });
```

`createClient` returns an [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client. Create an API key in Settings on makeworlds.dev. Options: `apiKey`, `baseUrl` (defaults to `https://makeworlds.dev`) and any openapi-fetch client option, such as `fetch` or `headers`.

## Types

Every schema in the API has a type: `WorldCreate` (the `POST /api/worlds` body), `SlackSpec`, `SlackUserSpec`, `SlackChannelSpec`, `SlackMessageSpec`, `SlackAppSpec`, `SlackInstallSpec`, `SlackCredentials`, `SlackState` (a spec with everything generated filled in), `World`, `WorldCreated`, `WorldSpec`, `Team`, `TeamDetail`, `Member`, `ApiKey`, `ApiKeyCreated` and `ApiError`. `paths` and `components` are exported for anything else.

The OpenAPI document is included as `makeworlds/openapi.json`.

## Develop

The types are generated from the API's routes, so they match it exactly:

```bash
pnpm --filter makeworlds generate
```

CI fails when `openapi.json` or `src/openapi.ts` is out of date.

## Release

Bump `version` in `package.json` in the commit that changes the API, and push to `main`. After CI deploys, `.github/workflows/publish-npm.yml` publishes any version that isn't on npm yet (npm trusted publishing, no token), tags it `makeworlds@<version>` and creates a GitHub release listing the commits since the last one. When the API changes without a bump, the run shows a warning. Don't publish from a laptop.

## License

[Apache 2.0](LICENSE)
