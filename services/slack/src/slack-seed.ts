import type { SlackSeedConfig } from "@emulators/slack";

export type SlackWorldConfig = {
  signingSecret: string;
  clientId: string;
  clientSecret: string;
  userToken: string;
  redirectUris: string[];
};

export function slackSeed(config: SlackWorldConfig): SlackSeedConfig {
  return {
    team: { name: "Worlds", domain: "worlds" },
    users: [{ name: "alice", real_name: "Alice Tester", email: "alice@worlds.test" }],
    channels: [{ name: "general" }],
    oauth_apps: [
      {
        app_id: "A_EMPIRICAL",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        name: "Empirical",
        redirect_uris: config.redirectUris,
        bot_name: "empirical",
      },
    ],
    tokens: [{ token: config.userToken, type: "user", user: "alice" }],
    signing_secret: config.signingSecret,
  };
}
