import type { SlackSeedConfig } from "@emulators/slack";

export function slackSeed(): SlackSeedConfig {
  return {
    team: { name: "Worlds", domain: "worlds" },
    users: [{ name: "alice", real_name: "Alice Tester", email: "alice@worlds.test" }],
    channels: [{ name: "general" }],
  };
}
