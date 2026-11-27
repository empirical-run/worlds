import type { Store } from "@emulators/core";
import { getSlackStore, normalizeScopes } from "@emulators/slack";
import type { SlackCredentials, SlackManifest } from "./manifest";

export { validateManifest, type ManifestProblem, type SlackCredentials, type SlackManifest } from "./manifest";

export type SlackApp = { app_id: string; manifest: SlackManifest; credentials: SlackCredentials };

export type EventTarget = { url: string; signingSecret: string };

const APPS_KEY = "worlds.apps";
const ALWAYS_DELIVERED = new Set(["app_uninstalled", "tokens_revoked"]);

export function listApps(store: Store): SlackApp[] {
  return store.getData<SlackApp[]>(APPS_KEY) ?? [];
}

export function findApp(store: Store, appId: string): SlackApp | undefined {
  return listApps(store).find((app) => app.app_id === appId);
}

export function createApp(store: Store, manifest: SlackManifest, pinned?: Partial<SlackCredentials>): SlackApp {
  const app: SlackApp = {
    app_id: `A${randomCode(10)}`,
    manifest,
    credentials: {
      client_id: pinned?.client_id ?? `${randomDigits(13)}.${randomDigits(13)}`,
      client_secret: pinned?.client_secret ?? randomHex(32),
      signing_secret: pinned?.signing_secret ?? randomHex(32),
      verification_token: pinned?.verification_token ?? randomCode(24),
    },
  };
  store.setData(APPS_KEY, [...listApps(store), app]);
  mirror(store, app);
  return app;
}

export function updateApp(store: Store, appId: string, manifest: SlackManifest): SlackApp | undefined {
  const app = findApp(store, appId);
  if (!app) return undefined;
  const updated = { ...app, manifest };
  store.setData(
    APPS_KEY,
    listApps(store).map((existing) => (existing.app_id === appId ? updated : existing)),
  );
  mirror(store, updated);
  return updated;
}

export function deleteApp(store: Store, appId: string): boolean {
  if (!findApp(store, appId)) return false;
  store.setData(
    APPS_KEY,
    listApps(store).filter((app) => app.app_id !== appId),
  );
  const slack = getSlackStore(store);
  for (const record of slack.oauthApps.findBy("app_id", appId)) slack.oauthApps.delete(record.id);
  for (const record of slack.installations.findBy("app_id", appId)) slack.installations.delete(record.id);
  for (const record of slack.tokens.findBy("app_id", appId)) slack.tokens.delete(record.id);
  return true;
}

export function eventTarget(store: Store, appId: string | undefined, eventType: string): EventTarget | null {
  const app = appId ? findApp(store, appId) : undefined;
  const subscriptions = app?.manifest.settings?.event_subscriptions;
  if (!app || !subscriptions?.request_url) return null;
  const events = subscriptions.bot_events ?? [];
  const subscribed =
    ALWAYS_DELIVERED.has(eventType) || events.includes(eventType) || (eventType === "message" && events.some((event) => event.startsWith("message.")));
  return subscribed ? { url: subscriptions.request_url, signingSecret: app.credentials.signing_secret } : null;
}

function mirror(store: Store, app: SlackApp): void {
  const slack = getSlackStore(store);
  const { manifest, credentials } = app;
  const fields = {
    app_id: app.app_id,
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    name: manifest.display_information.name,
    redirect_uris: manifest.oauth_config?.redirect_urls ?? [],
    scopes: normalizeScopes(manifest.oauth_config?.scopes?.bot),
    user_scopes: normalizeScopes(manifest.oauth_config?.scopes?.user),
    bot_name: manifest.features?.bot_user?.display_name,
    interactivity_url: manifest.settings?.interactivity?.is_enabled ? manifest.settings.interactivity.request_url : undefined,
  };
  const existing = slack.oauthApps.findOneBy("app_id", app.app_id);
  if (existing) slack.oauthApps.update(existing.id, fields);
  else slack.oauthApps.insert(fields);
}

const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomCode(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function randomDigits(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => String(byte % 10)).join("");
}

function randomHex(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length / 2))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
