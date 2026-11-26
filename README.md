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

## Slack

- Web API at `/api/*`, OAuth at `/oauth/v2/authorize`, inspector UI at `/`.
- `SLACK_EVENTS_URL` receives event callbacks, signed with `SLACK_SIGNING_SECRET`.
- Admin routes take `Authorization: Bearer $WORLDS_ADMIN_TOKEN`:
  - `POST /_worlds/reset` restores the seed.
  - `POST /_worlds/slack/redirect-uris` with `{ "redirect_uri": "..." }` registers an OAuth redirect URI on the app.

## Deploy

Pushes to `main` deploy through GitHub Actions (`.github/workflows/ci.yml`) after typecheck and the smoke test pass. Runtime secrets (`SLACK_*`, `WORLDS_ADMIN_TOKEN`) live on the Worker and are kept across deploys. The workflow needs a `CLOUDFLARE_API_TOKEN` repo secret with Workers Scripts: Edit on the empirical.run account.
