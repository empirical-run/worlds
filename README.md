# worlds

Hosted, stateful worlds of the third-party services an app depends on, for testing apps and agents end to end. Slack first; GitHub next.

A world is a Durable Object that holds the state of every service in it. Services in a world speak the real wire protocol (Web API, OAuth, signed event callbacks), so an app under test only needs its base URL pointed at the world.

Service behaviour comes from [emulate](https://github.com/vercel-labs/emulate) (`@emulators/*`). This repo adds hosting, persistence and the UI.

## Develop

```bash
pnpm install
cp services/world/.dev.vars.example services/world/.dev.vars
pnpm --filter @worlds/world exec wrangler d1 migrations apply worlds-db --local
pnpm --filter @worlds/world exec wrangler d1 execute worlds-db --local --file scripts/seed-smoke.sql
pnpm dev
pnpm smoke
```

`pnpm smoke` runs against the seeded smoke world: it checks the world's access rules, installs the app over OAuth, posts an @mention as a user, replies as the bot and checks the signed `app_mention` callback.

`services/world` is the `worlds` Worker on `*.makeworlds.dev`. Every world is one `World` Durable Object holding all of its services. Each service of a world has its own host, `{id}-{service}.makeworlds.dev` with the id minus its `world_` prefix (`https://k2v9x0q1m4-slack.makeworlds.dev`, `http://k2v9x0q1m4-slack.localhost:8787` in dev), so services sit at the root like the real ones; the Worker checks the world exists in D1 before routing to its Durable Object. `services/slack` is the Slack service module (`SlackService`) and its UI (`ui/`), which the world Worker serves; `wrangler dev` and `wrangler deploy` build the UI first.

## Slack

All paths below are on the world's Slack host, `https://{id}-slack.makeworlds.dev`. Create worlds with `POST /api/worlds` on makeworlds.dev.

- Web API at `/api/*`, OAuth at `/oauth/v2/authorize`.
- A Slack-style UI at `/`, for members of the world's team (makeworlds.dev session): channels, threads, mrkdwn, live updates. Pick a user under "Acting as" and post as them; `@name` becomes a real mention, so `@empirical` fires `app_mention` at the app under test. Create channels and add people (or the app) from the UI too.
- Files: upload with `files.getUploadURLExternal` → upload URL → `files.completeUploadExternal`, download `url_private`/`url_private_download` with a token. A file shared with an @mention sends `app_mention` with `files`, and images report `thumb_*` (both via `patches/@emulators__slack@0.14.0.patch`). File bytes are stored in their own chunked Durable Object keys, outside the world state, so screenshots don't hit the 2 MB value limit. The UI shows images and files, and attaches files from the composer (button, paste or drop).
- emulate's raw inspector moved to `/_inspector`.
- `SLACK_EVENTS_URL` (dev only for now; per-app event URLs come with app manifests) receives event callbacks, signed with `SLACK_SIGNING_SECRET`. Delivery works like Slack's: API calls return without waiting for the receiver; a non-2xx (unless `x-slack-no-retry: 1`), a connection failure or no response within 3s is retried with `X-Slack-Retry-Num`/`X-Slack-Retry-Reason`, right away, after 1 minute and after 5 minutes. Pending retries and the delivery log live in Durable Object storage and alarms, so they survive eviction.
- Control routes take the team's API key (`Authorization: Bearer wk_…`) or a makeworlds.dev session:
  - `POST /_worlds/slack/redirect-uris` with `{ "redirect_uri": "..." }` registers an OAuth redirect URI on the app.
  - `GET /_worlds/slack/state?channel=C…` returns users, channels and the channel's messages (the UI polls it).
  - `GET /_worlds/slack/files/F…` returns a file's bytes; `POST /_worlds/slack/upload` (multipart `user_id`, `channel`, `file`, optional `text`, `thread_ts`) shares a file as that user.
  - `POST /_worlds/slack/act` with `{ "user_id", "method", "args" }` calls a Web API method as that user, minting a user token when the user has none. Allowed methods: `chat.postMessage`, `conversations.create`, `conversations.invite`, `reactions.add`, `reactions.remove`.

## Site

The site at https://makeworlds.dev is `apps/web`: React Router 8 (framework mode, SSR) on the `worlds-site` Worker, with sign-in under `/auth/*`. It forwards `/api/*` over a service binding to `apps/api` (Hono + zod-openapi, Worker `worlds-api`), which serves `/api/openapi.json`; `/docs/api` renders the reference from it, and the account page reads and writes through the API. Schema and migrations live in `packages/db` (`pnpm db:generate`). `pnpm dev:site` runs the site with the API on :8790; CI applies migrations, then deploys the world Worker, the API and the site.

## Deploy

Worlds are served on the `*.makeworlds.dev/*` route (a proxied wildcard DNS record on the `makeworlds.dev` zone; the apex stays with the site). Pushes to `main` deploy through GitHub Actions (`.github/workflows/ci.yml`) after typecheck and the smoke test pass. Runtime secrets (`SLACK_*`) live on the Worker and are kept across deploys. The workflow needs a `CLOUDFLARE_API_TOKEN` repo secret with Workers Scripts: Edit on the empirical.run account.
