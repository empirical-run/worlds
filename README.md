# worlds

Hosted, stateful worlds of the third-party services an app depends on, for testing apps and agents end to end. Slack first; GitHub next.

A world is a Durable Object that holds the state of every service in it. Services in a world speak the real wire protocol (Web API, OAuth, signed event callbacks), so an app under test only needs its base URL pointed at the world.

Service behaviour comes from [emulate](https://github.com/vercel-labs/emulate) (`@emulators/*`). This repo adds hosting, persistence and the UI.

## Develop

```bash
pnpm install
cp services/slack/.dev.vars.example services/slack/.dev.vars
pnpm dev
pnpm smoke
```

`pnpm smoke` resets the world, installs the app over OAuth, posts an @mention as a user, replies as the bot and checks the signed `app_mention` callback.

The Slack service lives in `services/slack` (Worker in `src/`, UI in `ui/`). `wrangler dev` and `wrangler deploy` build the UI (Vite + React) first through the `build` command in `services/slack/wrangler.jsonc`.

## Slack

- Web API at `/api/*`, OAuth at `/oauth/v2/authorize`.
- A Slack-style UI at `/`, opened with the admin token: channels, threads, mrkdwn, live updates. Pick a user under "Acting as" and post as them; `@name` becomes a real mention, so `@empirical` fires `app_mention` at the app under test. Create channels and add people (or the app) from the UI too.
- Files: upload with `files.getUploadURLExternal` → upload URL → `files.completeUploadExternal`, download `url_private`/`url_private_download` with a token. A file shared with an @mention sends `app_mention` with `files`, and images report `thumb_*` (both via `patches/@emulators__slack@0.14.0.patch`). File bytes are stored in their own chunked Durable Object keys, outside the world state, so screenshots don't hit the 2 MB value limit. The UI shows images and files, and attaches files from the composer (button, paste or drop).
- emulate's raw inspector moved to `/_inspector`.
- `SLACK_EVENTS_URL` receives event callbacks, signed with `SLACK_SIGNING_SECRET`. Delivery works like Slack's: API calls return without waiting for the receiver; a non-2xx (unless `x-slack-no-retry: 1`), a connection failure or no response within 3s is retried with `X-Slack-Retry-Num`/`X-Slack-Retry-Reason`, right away, after 1 minute and after 5 minutes. Pending retries and the delivery log live in Durable Object storage and alarms, so they survive eviction.
- Admin routes take `Authorization: Bearer $WORLDS_ADMIN_TOKEN`:
  - `POST /_worlds/reset` restores the seed.
  - `POST /_worlds/slack/redirect-uris` with `{ "redirect_uri": "..." }` registers an OAuth redirect URI on the app.
  - `GET /_worlds/slack/state?channel=C…` returns users, channels and the channel's messages (the UI polls it).
  - `GET /_worlds/slack/files/F…` returns a file's bytes; `POST /_worlds/slack/upload` (multipart `user_id`, `channel`, `file`, optional `text`, `thread_ts`) shares a file as that user.
  - `POST /_worlds/slack/act` with `{ "user_id", "method", "args" }` calls a Web API method as that user, minting a user token when the user has none. Allowed methods: `chat.postMessage`, `conversations.create`, `conversations.invite`, `reactions.add`, `reactions.remove`.

## Site

The site at https://makeworlds.dev (pages, sign-in, account) is the `site/` Worker. It forwards `/api/*` over a service binding to `apps/api` (Hono + zod-openapi, Worker `worlds-api`), which serves `/api/openapi.json`; `/docs/api` renders the reference from it. Schema and migrations live in `packages/db` (`pnpm db:generate`). `pnpm dev:site` runs both Workers on :8790; CI applies migrations, then deploys the API and the site after the Slack service.

## Deploy

Production is https://slack.makeworlds.dev (custom domain on the `makeworlds.dev` zone; `WORLDS_SLACK_URL` pins the base URL in Slack responses). worlds.empirical-run.workers.dev serves the same world. Pushes to `main` deploy through GitHub Actions (`.github/workflows/ci.yml`) after typecheck and the smoke test pass. Runtime secrets (`SLACK_*`, `WORLDS_ADMIN_TOKEN`) live on the Worker and are kept across deploys. The workflow needs a `CLOUDFLARE_API_TOKEN` repo secret with Workers Scripts: Edit on the empirical.run account.
