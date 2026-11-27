import type { ServiceHosting, ServiceRuntime } from "@worlds/contract/hosting";
import { jiraHosting } from "@worlds/jira/hosting";
import { linearHosting } from "@worlds/linear/hosting";
import { slackHosting } from "@worlds/slack/hosting";

import { SERVICES, type ServiceName, type ServiceSpec, type ServiceState } from "./index";

export const HOSTING: {
  [Name in ServiceName]: ServiceHosting<ServiceSpec<Name>, ServiceState<Name>>;
} = { slack: slackHosting, jira: jiraHosting, linear: linearHosting };

export type ServiceRuntimes = {
  [Name in ServiceName]: ServiceRuntime<ServiceSpec<Name>, ServiceState<Name>>;
};

export function serviceRuntimes(storage: DurableObjectStorage): ServiceRuntimes {
  return Object.fromEntries(
    SERVICES.map(({ name }) => [name, HOSTING[name].runtime(storage)]),
  ) as ServiceRuntimes;
}
