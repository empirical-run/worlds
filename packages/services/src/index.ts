import type { z } from "@hono/zod-openapi";
import { jira } from "@worlds/jira/contract";
import { slack } from "@worlds/slack/contract";

export const SERVICES = [slack, jira] as const;

type ServiceContract = (typeof SERVICES)[number];

export type ServiceName = ServiceContract["name"];

export type ServiceHost = ServiceContract["hosts"][number];

type Contract<Name extends ServiceName> = Extract<ServiceContract, { name: Name }>;

export type ServiceSpec<Name extends ServiceName> = z.output<Contract<Name>["spec"]>;

export type ServiceState<Name extends ServiceName> = z.output<Contract<Name>["state"]>;

export type WorldSpecs = { [Name in ServiceName]?: ServiceSpec<Name> };

export type WorldStates = { [Name in ServiceName]: ServiceState<Name> | null };

type WorldUrls = { [Name in ServiceName]: z.output<Contract<Name>["urls"]> };

export function resolveHost(
  host: string,
): { service: ServiceContract; host: ServiceHost } | undefined {
  for (const service of SERVICES)
    for (const candidate of service.hosts)
      if (candidate === host) return { service, host: candidate };
  return undefined;
}

function byService<Shape extends Record<ServiceName, unknown>>(
  build: (service: ServiceContract) => Shape[ServiceName],
): Shape {
  return Object.fromEntries(SERVICES.map((service) => [service.name, build(service)])) as Shape;
}

export function worldUrls(origin: (host: ServiceHost) => string): WorldUrls {
  return byService<WorldUrls>((service) => service.urlsFor(origin));
}

const [mainService] = SERVICES;

export function worldUiUrl(origin: (host: ServiceHost) => string): string {
  return mainService.uiUrl(origin);
}

export const worldUiDescription = `The world's main page: ${mainService.title}'s UI. Each service's own URLs are under its name.`;

export function serviceTitles(conjunction: "and" | "or"): string {
  const titles = SERVICES.map((service) => service.title);
  const last = titles.pop();
  return titles.length ? `${titles.join(", ")} ${conjunction} ${last}` : (last ?? "");
}

export function specProblems(specs: WorldSpecs): string[] {
  return SERVICES.flatMap((service) =>
    specs[service.name] === undefined
      ? []
      : service.problems(specs[service.name]).map((problem) => `${service.name}.${problem}`),
  );
}

export const urlsShape = byService<{ [Name in ServiceName]: Contract<Name>["urls"] }>(
  (service) => service.urls,
);

export const specShape = byService<{
  [Name in ServiceName]: z.ZodOptional<Contract<Name>["spec"]>;
}>((service) => service.spec.optional());

export const stateShape = byService<{
  [Name in ServiceName]: z.ZodNullable<Contract<Name>["state"]>;
}>((service) => service.state.nullable());

export const createdShape = byService<Record<ServiceName, z.ZodObject>>((service) =>
  service.urls.extend({ spec: service.state }),
);

export function withSpecs(urls: WorldUrls, states: WorldStates) {
  return byService<Record<ServiceName, Record<string, unknown>>>((service) => ({
    ...urls[service.name],
    spec: states[service.name],
  }));
}
