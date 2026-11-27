import { isJiraHost } from "@worlds/jira/contract";
import { JiraService } from "@worlds/jira/service";
import type { ServiceHost, ServiceName, ServiceSpec, ServiceState } from "@worlds/services";
import { SlackService } from "@worlds/slack/service";

export type WorldContext = { worldId: string; origin: (host: ServiceHost) => string };

export type ServiceRuntime<Name extends ServiceName> = {
  setup(spec: ServiceSpec<Name> | undefined, world: WorldContext): Promise<ServiceState<Name>>;
  state(): Promise<ServiceState<Name> | null>;
  fetch(request: Request, host: ServiceHost, world: WorldContext): Promise<Response>;
  alarm(world: WorldContext | null): Promise<void>;
  nextDue(): Promise<number | null>;
};

export type ServiceRuntimes = { [Name in ServiceName]: ServiceRuntime<Name> };

export function serviceRuntimes(storage: DurableObjectStorage): ServiceRuntimes {
  const slack = new SlackService(storage);
  const jira = new JiraService(storage);
  const jiraOrigins = (world: WorldContext) => ({
    site: world.origin("jira"),
    auth: world.origin("jira-auth"),
    api: world.origin("jira-api"),
  });
  return {
    slack: {
      setup: (spec, world) => slack.setup(spec, world.origin("slack")),
      state: () => slack.state(),
      fetch: (request) => slack.fetch(request, new URL(request.url).origin),
      alarm: () => slack.alarm(),
      nextDue: () => slack.nextDue(),
    },
    jira: {
      setup: (spec, world) => jira.setup(spec, jiraOrigins(world)),
      state: () => jira.state(),
      fetch: async (request, host, world) =>
        isJiraHost(host)
          ? jira.fetch(request, host, jiraOrigins(world))
          : Response.json({ code: 404, message: "Not Found" }, { status: 404 }),
      alarm: (world) => jira.alarm(world ? jiraOrigins(world) : null),
      nextDue: () => jira.nextDue(),
    },
  };
}
