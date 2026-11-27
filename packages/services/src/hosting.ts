import type { ServiceHosting, ServiceRuntime } from "@worlds/contract/hosting";
import { googleHosting } from "@worlds/google/hosting";
import { jiraHosting } from "@worlds/jira/hosting";
import { linearHosting } from "@worlds/linear/hosting";
import { slackHosting } from "@worlds/slack/hosting";

import { SERVICES, type ServiceName, type ServiceSpec, type ServiceState } from "./index";

export const HOSTING: {
  [Name in ServiceName]: ServiceHosting<ServiceSpec<Name>, ServiceState<Name>>;
} = { slack: slackHosting, jira: jiraHosting, linear: linearHosting, google: googleHosting };

export type ServiceRuntimes = {
  [Name in ServiceName]: ServiceRuntime<ServiceSpec<Name>, ServiceState<Name>>;
};

export function serviceRuntimes(storage: DurableObjectStorage): ServiceRuntimes {
  return Object.fromEntries(
    SERVICES.map(({ name }) => [name, HOSTING[name].runtime(storage)]),
  ) as ServiceRuntimes;
}
