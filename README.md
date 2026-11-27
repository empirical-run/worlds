# <img src="apps/web/public/logo.svg" alt="" height="22"> worlds

Hosted, stateful worlds of the third-party services an app depends on, for testing apps and agents end to end. Slack, Jira and Linear; GitHub next.

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

`pnpm smoke` runs each service's `scripts/smoke.mjs`, one at a time. Slack's creates a world through the API from a full spec, checks the spec landed (pinned ids and tokens, seeded threads, preinstalled bot), the world's access rules, installs the app over OAuth, posts an @mention as a user, replies as the bot and checks the signed `app_mention` callback. Jira's installs a Jira app over 3LO, registers a dynamic webhook and checks signed issue and comment deliveries.

`services/world` is the `worlds` Worker on `*.makeworlds.dev`. Every world is one `World` Durable Object holding the services it was created with (D1 `worlds.services`; a world has only the services its create body has a spec for). Each service of a world has its own host, `{id}-{service}.makeworlds.dev` with the id minus its `world_` prefix (`https://k2v9x0q1m4-slack.makeworlds.dev`, `http://k2v9x0q1m4-slack.localhost:8787` in dev), so services sit at the root like the real ones; the Worker checks the world exists in D1 and has that service before routing to its Durable Object. `services/slack` is the Slack service module (`SlackService`) and its UI (`ui/`). `wrangler dev` and `wrangler deploy` run `scripts/build-ui.mjs`, which builds every service with a `build:ui` script and copies its `ui/dist` to `dist/ui/<service>`; the world Worker serves a service's UI and `/assets/*` from there on that service's host. A new UI also needs its `ui/src` in `build.watch_dir` in `services/world/wrangler.jsonc`.

## Slack

All paths below are on the world's Slack host, `https://{id}-slack.makeworlds.dev`. Create worlds with `POST /api/worlds` on makeworlds.dev.

- Web API at `/api/*`, OAuth at `/oauth/v2/authorize`.
- A Slack-style UI at `/`, for members of the world's team (makeworlds.dev session): channels, threads, mrkdwn, live updates. Pick a user under "Acting as" and post as them; `@name` becomes a real mention, so `@empirical` fires `app_mention` at the app under test. Create channels and add people (or the app) from the UI too.
- Files: upload with `files.getUploadURLExternal` → upload URL → `files.completeUploadExternal`, download `url_private`/`url_private_download` with a token. A file shared with an @mention sends `app_mention` with `files`, and images report `thumb_*` (both via `patches/@emulators__slack@0.14.0.patch`). File bytes are stored in their own chunked Durable Object keys, outside the world state, so screenshots don't hit the 2 MB value limit. The UI shows images and files, and attaches files from the composer (button, paste or drop).
- emulate's raw inspector moved to `/_inspector`.
- Everything in a world's Slack workspace comes from the `slack` spec in `POST /api/worlds`: team, users (optional pinned tokens), channels with members and seeded messages, and apps (Slack app manifests, optional pinned credentials, optional install with pinned bot user, bot token and channels). Generated values are filled in and returned as `slack.spec`, also at `GET /api/worlds/{id}/spec`; a world never changes its spec. `apps.manifest.export/validate` work, `create/update/delete` answer `restricted_action`. OAuth checks the manifest's `redirect_urls` (Slack's matching, plus `*` host wildcards). Events go to each installed app that subscribes to them (`bot_events`), at its `request_url`, signed with its own signing secret.
- Control routes (`/_worlds/slack/*`: user tokens, workspace state, act as a user, share and download files) are in the [API reference](https://makeworlds.dev/docs/api) under Slack world. `act` calls `chat.postMessage`, `conversations.create`, `conversations.invite`, `reactions.add` or `reactions.remove`.

## Specs

`specs/*.json` are world specs (the `POST /api/worlds` body, `WorldCreate` in [`makeworlds`](packages/makeworlds), the typed API client on npm). Secrets are `${ENV}` placeholders. Create a world from one with:

```bash
WORLDS_API_KEY=wk_live_… node scripts/create-world.mjs specs/empirical-preview.json
```

`specs/empirical-preview.json` is the world api-preview talks to: the Empirical app with api-preview's credentials (`WORLDS_SLACK_CLIENT_ID`, `WORLDS_SLACK_CLIENT_SECRET`, `WORLDS_SLACK_SIGNING_SECRET`), events to api-preview, and redirect URLs for dashboard previews and localhost.

`services/slack/scripts/preview-mention.mjs` then runs the @mention flow against api-preview: it installs the world's Empirical app on Empirical over OAuth (redirect URI `http://localhost:3000/api/slack/oauth/callback` by default, one of the spec's `redirect_urls`), creates a channel as alice, invites the bot, mentions it and waits for the reply. It needs `WORLDS_API_KEY`, `WORLD_ID` and the `empirical` CLI signed in to staging.

## Jira

A world with a `jira` spec has a Jira Cloud site, written for this repo (emulate has no Jira) in `services/jira`. Like Atlassian it answers on three hosts:

| Atlassian              | World host                      | Serves                                                                                                                                                                                                             |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.atlassian.com`   | `{id}-jira-auth.makeworlds.dev` | `/authorize` (consent page: pick the user), `/oauth/token` (authorization_code, rotating refresh tokens with a 10-minute reuse window)                                                                             |
| `api.atlassian.com`    | `{id}-jira-api.makeworlds.dev`  | `/oauth/token/accessible-resources`, `/ex/jira/{cloudId}/rest/api/3/…`: `GET issue/{key}`, `POST issue/{key}/comment` (ADF), `GET user?accountId=`, `GET myself`, `GET/POST/DELETE webhook`, `PUT webhook/refresh` |
| `{site}.atlassian.net` | `{id}-jira.makeworlds.dev`      | the site URL in `issue.self` and webhooks; `/` and `/browse/{key}` for the world's team; `/rest/*` refuses OAuth tokens                                                                                            |

- The spec (`POST /api/worlds` with `jira: { site, users, projects, issues, apps }`) seeds once. Apps are OAuth 2.0 (3LO) integrations: `name`, `callback_urls` (`*` matches one host label), `scopes`, optional pinned `credentials`. The cloud id is a random UUID per world unless pinned.
- REST responses are v3 (ADF descriptions and comments); webhook payloads are v2 (plain-text bodies), like Jira's.
- Dynamic webhooks: one URL per app and user, up to 5, 30-day expiry. JQL supports `labels`, `project`, `status`, `issuekey`, `assignee`, `reporter` with `=`, `!=`, `in`, `not in` joined by `AND`; anything else is refused at registration. Events: `jira:issue_created|updated|deleted`, `comment_created`. Deliveries carry `Authorization: Bearer <JWT HS256 signed with the client secret>` and `X-Atlassian-Webhook-Identifier`, and are retried up to 5 times, 5 to 15 minutes apart (`X-Atlassian-Webhook-Retry`), on 408/409/425/429/5xx or no answer within 10s.
- Control routes on the site host (`/_worlds/jira/*`: create, change, comment on and delete issues, site state) are in the [API reference](https://makeworlds.dev/docs/api) under Jira world. Changes send the webhooks Jira would (`issue_assigned` for an assignee-only change, `issue_generic` for a status-only change).

## Linear

A world with a `linear` spec has a Linear workspace, written for this repo in `services/linear`. Like Linear it answers on two hosts:

| Linear           | World host                       | Serves                                                                                                                                                        |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `linear.app`     | `{id}-linear.makeworlds.dev`     | `/oauth/authorize` (consent page: pick who authorizes; `actor=app` installs an app user), issue pages at `/{url_key}/issue/{identifier}` for the world's team |
| `api.linear.app` | `{id}-linear-api.makeworlds.dev` | `/graphql`, `/oauth/token` (authorization_code, refresh_token), `/oauth/revoke`                                                                               |

- The spec (`POST /api/worlds` with `linear: { workspace, users, teams, issues, apps }`) seeds once. Apps are OAuth applications: `name`, `callback_urls` (`*` matches one host label), `scopes`, optional `webhook_url`, optional pinned `credentials` (client id, client secret, webhook signing secret). The organization id is a random UUID unless pinned.
- Tokens follow Linear's OAuth: 24-hour access tokens, refresh tokens that rotate on every refresh and expire 30 days after issue, and a 30-minute window in which retrying a used refresh token returns the same replacement pair. `app:assignable`/`app:mentionable` need `actor=app`; `actor=app` can't ask for `admin`.
- `/graphql` runs a subset of Linear's schema with graphql-js: `viewer`, `organization`, `teams`, `team`, `users`, `issue(id)` (UUID or identifier), and `commentCreate`, `reactionCreate`, `attachmentCreate` (upserts by URL). Field names, the `AUTHENTICATION_ERROR` (401) and `GRAPHQL_VALIDATION_FAILED` (400) errors and `Entity not found` match api.linear.app.
- Webhooks go to an installed app's `webhook_url`: `AppUserNotification` (`issueAssignedToYou`, `issueUnassignedFromYou`) when a member assigns an issue to or away from the app user, and `OAuthApp` `revoked` when the app is uninstalled. Payloads follow Linear's published `AppUserNotificationWebhookPayload` and `OAuthAppWebhookPayload` types; each delivery has `Linear-Delivery`, `Linear-Event`, `Linear-Timestamp` and `Linear-Signature` (hex HMAC-SHA256 of the body with the webhook secret), a fresh `webhookTimestamp`, and is retried after 1 minute, 1 hour and 6 hours unless the app answers 200 within 5 seconds.
- Control routes on the app host (`/_worlds/linear/*`: create, change and comment on issues as a member, uninstall an app, workspace state) are in the [API reference](https://makeworlds.dev/docs/api) under Linear world.

## Services

Each service (Slack, Jira, Linear) is a package in `services/<name>` with two entry points:

- `src/contract.ts`: zod-openapi schemas for its spec and state, the URLs a world gets, spec checks, a `starter` spec (what the makeworlds.dev create form sends), and the `/_worlds/<name>/*` control routes. A spec requires what a person would choose (a Slack team name, a Jira reporter); the service generates only ids, tokens and credentials, never other defaults. The service serves the same route objects with `OpenAPIHono`, so requests are validated against the published spec.
- `src/hosting.ts`: its runtime in the world's Durable Object (setup, state, fetch, alarms), its page rules (sign-in gate, UI page and assets), its error shape for requests the world Worker answers itself (an unknown or archived world), and any banner CSS its pages need.
- `scripts/smoke.mjs`: its end-to-end smoke test against `wrangler dev`.

`packages/services` lists them, with an entry point per side:

- `@worlds/services` lists the contracts. The API builds `World`, `WorldCreate`, `WorldCreated` and `WorldSpec` from it and adds every control route to `/api/openapi.json`, each with its world host as the server. It loads no service runtime code.
- `@worlds/services/hosting` lists the hosting, typed over the contract list, so a service with a contract but no hosting won't typecheck. The world worker runs whatever it lists.

`packages/contract` has what services share: the `ApiError` shape, `defineService`, `worldServer`, `userRef`, the validating router and (in `@worlds/contract/hosting`) the runtime types. Control routes take the team's API key or a makeworlds.dev session, name the acting user `user` (name or id), and answer errors as `{ "error": { "code", "message" } }`.

To add a service: write its package with `contract.ts` and `hosting.ts`, and add one line to each list in `packages/services`.

## Site

The site at https://makeworlds.dev is `apps/web`: React Router 8 (framework mode, SSR) on the `worlds-site` Worker, with sign-in under `/auth/*`. It forwards `/api/*` over a service binding to `apps/api` (Hono + zod-openapi, Worker `worlds-api`), which serves `/api/openapi.json`; `/docs/api` renders the reference from it, and the account page reads and writes through the API. Schema and migrations live in `packages/db` (`pnpm db:generate`). `pnpm dev:site` runs the site with the API on :8790; CI applies migrations, then deploys the world Worker, the API and the site.

## Deploy

Worlds are served on the `*.makeworlds.dev/*` route (a proxied wildcard DNS record on the `makeworlds.dev` zone; the apex stays with the site). Pushes to `main` deploy through GitHub Actions (`.github/workflows/ci.yml`) after typecheck and the smoke test pass. The world Worker needs no secrets (Slack app credentials live in each world) and are kept across deploys. The workflow needs a `CLOUDFLARE_API_TOKEN` repo secret with Workers Scripts: Edit on the empirical.run account.

## License

[Apache 2.0](LICENSE)
