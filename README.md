# worlds

Hosted, stateful twins of the third-party APIs an app depends on, for testing apps and agents end to end. Slack first; GitHub next.

A world is a Durable Object that holds the state of every twin in it. Twins speak the real wire protocol (Web API, OAuth, signed event callbacks), so an app under test only needs its base URL pointed at the world.

Twin behaviour comes from [emulate](https://github.com/vercel-labs/emulate) (`@emulators/*`). This repo adds hosting, persistence and the UI.

## Develop

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
pnpm smoke
```

`pnpm smoke` resets the world, installs the app over OAuth, posts an @mention as a user, replies as the bot and checks the signed `app_mention` callback.

`wrangler dev` and `wrangler deploy` build the UI (`ui/`, Vite + React) first through the `build` command in `wrangler.jsonc`.

## Slack

- Web API at `/api/*`, OAuth at `/oauth/v2/authorize`.
- A Slack-style UI at `/`, opened with the admin token: channels, threads, mrkdwn, live updates. Pick a user under "Acting as" and post as them; `@name` becomes a real mention, so `@empirical` fires `app_mention` at the app under test. Create channels and add people (or the app) from the UI too.
- emulate's raw inspector moved to `/_inspector`.
- `SLACK_EVENTS_URL` receives event callbacks, signed with `SLACK_SIGNING_SECRET`. Delivery works like Slack's: API calls return without waiting for the receiver; a non-2xx (unless `x-slack-no-retry: 1`), a connection failure or no response within 3s is retried with `X-Slack-Retry-Num`/`X-Slack-Retry-Reason`, right away, after 1 minute and after 5 minutes. Pending retries and the delivery log live in Durable Object storage and alarms, so they survive eviction.
- Admin routes take `Authorization: Bearer $WORLDS_ADMIN_TOKEN`:
  - `POST /_worlds/reset` restores the seed.
  - `POST /_worlds/slack/redirect-uris` with `{ "redirect_uri": "..." }` registers an OAuth redirect URI on the app.
  - `GET /_worlds/slack/state?channel=C…` returns users, channels and the channel's messages (the UI polls it).
  - `POST /_worlds/slack/act` with `{ "user_id", "method", "args" }` calls a Web API method as that user, minting a user token when the user has none. Allowed methods: `chat.postMessage`, `conversations.create`, `conversations.invite`, `reactions.add`, `reactions.remove`.

## Deploy

Pushes to `main` deploy through GitHub Actions (`.github/workflows/ci.yml`) after typecheck and the smoke test pass. Runtime secrets (`SLACK_*`, `WORLDS_ADMIN_TOKEN`) live on the Worker and are kept across deploys. The workflow needs a `CLOUDFLARE_API_TOKEN` repo secret with Workers Scripts: Edit on the empirical.run account.
