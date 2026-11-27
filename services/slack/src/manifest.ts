export type SlackManifest = {
  display_information: { name: string; description?: string };
  features?: { bot_user?: { display_name?: string; always_online?: boolean } };
  oauth_config?: { redirect_urls?: string[]; scopes?: { bot?: string[]; user?: string[] } };
  settings?: {
    event_subscriptions?: { request_url?: string; bot_events?: string[] };
    interactivity?: { is_enabled?: boolean; request_url?: string };
  };
};

export type SlackCredentials = {
  client_id: string;
  client_secret: string;
  signing_secret: string;
  verification_token: string;
};

export type ManifestProblem = { message: string; pointer: string };

export function validateManifest(value: unknown): { manifest: SlackManifest } | { problems: ManifestProblem[] } {
  const problems: ManifestProblem[] = [];
  const manifest = value as SlackManifest;
  if (typeof value !== "object" || value === null) return { problems: [{ message: "Manifest must be a JSON object", pointer: "/" }] };
  if (typeof manifest.display_information?.name !== "string" || !manifest.display_information.name.trim()) {
    problems.push({ message: "Field is required", pointer: "/display_information/name" });
  }
  const stringLists: [unknown, string][] = [
    [manifest.oauth_config?.redirect_urls, "/oauth_config/redirect_urls"],
    [manifest.oauth_config?.scopes?.bot, "/oauth_config/scopes/bot"],
    [manifest.oauth_config?.scopes?.user, "/oauth_config/scopes/user"],
    [manifest.settings?.event_subscriptions?.bot_events, "/settings/event_subscriptions/bot_events"],
  ];
  for (const [list, pointer] of stringLists) {
    if (list !== undefined && !(Array.isArray(list) && list.every((item) => typeof item === "string"))) {
      problems.push({ message: "Must be an array of strings", pointer });
    }
  }
  const urls: [unknown, string][] = [
    [manifest.settings?.event_subscriptions?.request_url, "/settings/event_subscriptions/request_url"],
    [manifest.settings?.interactivity?.request_url, "/settings/interactivity/request_url"],
  ];
  for (const [url, pointer] of urls) {
    if (url !== undefined && (typeof url !== "string" || !URL.canParse(url))) problems.push({ message: "Must be a URL", pointer });
  }
  return problems.length ? { problems } : { manifest };
}
