# worlds

Hosted, stateful worlds of the third-party services an app depends on, for testing apps and agents end to end. Slack and Jira; GitHub next.

A world is a Durable Object that holds the state of every service in it. Services in a world speak the real wire protocol (Web API, OAuth, signed event callbacks), so an app under test only needs its base URL pointed at the world.

Service behaviour comes from [emulate](https://github.com/vercel-labs/emulate) (`@emulators/*`). This repo adds hosting, persistence and the UI.

## Develop

```bash
pnpm install
cp services/world/.dev.vars.example services/world/.dev.vars
# world Worker on :8787, API on :8791 (shared local D1)
pnpm --filter @worlds/world exec wrangler d1 migrations apply worlds-db --local
pnpm --filter @worlds/world exec wrangler d1 execute worlds-db --local --file scripts/seed-smoke.sql
pnpm dev &
pnpm dev:api &
pnpm smoke
```

`pnpm smoke` runs two scripts. `smoke.mjs` creates a world through the API from a full spec, checks the spec landed (pinned ids and tokens, seeded threads, preinstalled bot), the world's access rules, installs the app over OAuth, posts an @mention as a user, replies as the bot and checks the signed `app_mention` callback. `jira-smoke.mjs` installs a Jira app over 3LO, registers a dynamic webhook and checks signed issue and comment deliveries.

`services/world` is the `worlds` Worker on `*.makeworlds.dev`. Every world is one `World` Durable Object holding all of its services. Each service of a world has its own host, `{id}-{service}.makeworlds.dev` with the id minus its `world_` prefix (`https://k2v9x0q1m4-slack.makeworlds.dev`, `http://k2v9x0q1m4-slack.localhost:8787` in dev), so services sit at the root like the real ones; the Worker checks the world exists in D1 before routing to its Durable Object. `services/slack` is the Slack service module (`SlackService`) and its UI (`ui/`), which the world Worker serves; `wrangler dev` and `wrangler deploy` build the UI first.

## Slack

All paths below are on the world's Slack host, `https://{id}-slack.makeworlds.dev`. Create worlds with `POST /api/worlds` on makeworlds.dev.

- Web API at `/api/*`, OAuth at `/oauth/v2/authorize`.
- A Slack-style UI at `/`, for members of the world's team (makeworlds.dev session): channels, threads, mrkdwn, live updates. Pick a user under "Acting as" and post as them; `@name` becomes a real mention, so `@empirical` fires `app_mention` at the app under test. Create channels and add people (or the app) from the UI too.
- Files: upload with `files.getUploadURLExternal` → upload URL → `files.completeUploadExternal`, download `url_private`/`url_private_download` with a token. A file shared with an @mention sends `app_mention` with `files`, and images report `thumb_*` (both via `patches/@emulators__slack@0.14.0.patch`). File bytes are stored in their own chunked Durable Object keys, outside the world state, so screenshots don't hit the 2 MB value limit. The UI shows images and files, and attaches files from the composer (button, paste or drop).
- emulate's raw inspector moved to `/_inspector`.
- Everything in a world's Slack workspace comes from the `slack` spec in `POST /api/worlds`: team, users (optional pinned tokens), channels with members and seeded messages, and apps (Slack app manifests, optional pinned credentials, optional install with pinned bot user, bot token and channels). Generated values are filled in and returned as `slack.spec`, also at `GET /api/worlds/{id}/spec`; a world never changes its spec. `apps.manifest.export/validate` work, `create/update/delete` answer `restricted_action`. OAuth checks the manifest's `redirect_urls` (Slack's matching, plus `*` host wildcards). Events go to each installed app that subscribes to them (`bot_events`), at its `request_url`, signed with its own signing secret.
- Control routes take the team's API key (`Authorization: Bearer wk_…`) or a makeworlds.dev session:
  - `POST /_worlds/slack/tokens` with `{ "user_id" }` returns that user's token.
  - `GET /_worlds/slack/state?channel=C…` returns users, channels and the channel's messages (the UI polls it).
  - `GET /_worlds/slack/files/F…` returns a file's bytes; `POST /_worlds/slack/upload` (multipart `user_id`, `channel`, `file`, optional `text`, `thread_ts`) shares a file as that user.
  - `POST /_worlds/slack/act` with `{ "user_id", "method", "args" }` calls a Web API method as that user, minting a user token when the user has none. Allowed methods: `chat.postMessage`, `conversations.create`, `conversations.invite`, `reactions.add`, `reactions.remove`.

## Specs

`specs/*.json` are world specs (the `POST /api/worlds` body, `WorldCreate` in [`makeworlds`](packages/makeworlds), the typed API client on npm). Secrets are `${ENV}` placeholders. Create a world from one with:

```bash
WORLDS_API_KEY=wk_live_… node scripts/create-world.mjs specs/empirical-preview.json
```

`specs/empirical-preview.json` is the world api-preview talks to: the Empirical app with api-preview's credentials (`WORLDS_SLACK_CLIENT_ID`, `WORLDS_SLACK_CLIENT_SECRET`, `WORLDS_SLACK_SIGNING_SECRET`), events to api-preview, and redirect URLs for dashboard previews and localhost.

## Jira

Every world has a Jira Cloud site, written for this repo (emulate has no Jira) in `services/jira`. Like Atlassian it answers on three hosts:

| Atlassian | World host | Serves |
|---|---|---|
| `auth.atlassian.com` | `{id}-jira-auth.makeworlds.dev` | `/authorize` (consent page: pick the user), `/oauth/token` (authorization_code, rotating refresh tokens with a 10-minute reuse window) |
| `api.atlassian.com` | `{id}-jira-api.makeworlds.dev` | `/oauth/token/accessible-resources`, `/ex/jira/{cloudId}/rest/api/3/…`: `GET issue/{key}`, `POST issue/{key}/comment` (ADF), `GET user?accountId=`, `GET myself`, `GET/POST/DELETE webhook`, `PUT webhook/refresh` |
| `{site}.atlassian.net` | `{id}-jira.makeworlds.dev` | the site URL in `issue.self` and webhooks; `/` and `/browse/{key}` for the world's team; `/rest/*` refuses OAuth tokens |

- The spec (`POST /api/worlds` with `jira: { site, users, projects, issues, apps }`) seeds once. Apps are OAuth 2.0 (3LO) integrations: `name`, `callback_urls` (`*` matches one host label), `scopes`, optional pinned `credentials`. The cloud id is a random UUID per world unless pinned.
- REST responses are v3 (ADF descriptions and comments); webhook payloads are v2 (plain-text bodies), like Jira's.
- Dynamic webhooks: one URL per app and user, up to 5, 30-day expiry. JQL supports `labels`, `project`, `status`, `issuekey`, `assignee`, `reporter` with `=`, `!=`, `in`, `not in` joined by `AND`; anything else is refused at registration. Events: `jira:issue_created|updated|deleted`, `comment_created`. Deliveries carry `Authorization: Bearer <JWT HS256 signed with the client secret>` and `X-Atlassian-Webhook-Identifier`, and are retried up to 5 times, 5 to 15 minutes apart (`X-Atlassian-Webhook-Retry`), on 408/409/425/429/5xx or no answer within 10s.
- Control routes on the site host (team API key or session): `POST /_worlds/jira/issues` (`{ user, project?, summary, description?, labels?, status?, assignee? }`), `PATCH /_worlds/jira/issues/{key}`, `DELETE /_worlds/jira/issues/{key}?user=`, `POST /_worlds/jira/issues/{key}/comments` (`{ user, body }`), `GET /_worlds/jira/state`. Changes send the webhooks Jira would (`issue_assigned` for an assignee-only change, `issue_generic` for a status-only change).

## Site

The site at https://makeworlds.dev is `apps/web`: React Router 8 (framework mode, SSR) on the `worlds-site` Worker, with sign-in under `/auth/*`. It forwards `/api/*` over a service binding to `apps/api` (Hono + zod-openapi, Worker `worlds-api`), which serves `/api/openapi.json`; `/docs/api` renders the reference from it, and the account page reads and writes through the API. Schema and migrations live in `packages/db` (`pnpm db:generate`). `pnpm dev:site` runs the site with the API on :8790; CI applies migrations, then deploys the world Worker, the API and the site.

## Deploy

Worlds are served on the `*.makeworlds.dev/*` route (a proxied wildcard DNS record on the `makeworlds.dev` zone; the apex stays with the site). Pushes to `main` deploy through GitHub Actions (`.github/workflows/ci.yml`) after typecheck and the smoke test pass. The world Worker needs no secrets (Slack app credentials live in each world) and are kept across deploys. The workflow needs a `CLOUDFLARE_API_TOKEN` repo secret with Workers Scripts: Edit on the empirical.run account.

## License

[Apache 2.0](LICENSE)
