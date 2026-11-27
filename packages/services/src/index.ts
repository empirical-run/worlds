import { z } from "@hono/zod-openapi";
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

type WorldUrls = { [Name in ServiceName]: z.output<Contract<Name>["urls"]> | null };

export const SERVICE_NAMES = SERVICES.map((service) => service.name) as [
  ServiceName,
  ...ServiceName[],
];

export function specifiedServices(specs: WorldSpecs): ServiceName[] {
  return SERVICES.filter((service) => specs[service.name] !== undefined).map(
    (service) => service.name,
  );
}

type StarterSpecs = { [Name in ServiceName]: z.input<Contract<Name>["spec"]> };

const STARTER_SPECS = byService<StarterSpecs>((service) => service.starter);

export function starterSpecs(names: readonly string[]): Partial<StarterSpecs> {
  return Object.fromEntries(
    SERVICES.filter((service) => names.includes(service.name)).map((service) => [
      service.name,
      STARTER_SPECS[service.name],
    ]),
  );
}

export function resolveHost(
  host: string,
): { service: ServiceContract; host: ServiceHost } | undefined {
  for (const service of SERVICES) {
    for (const candidate of service.hosts) {
      if (candidate === host) {
        return { service, host: candidate };
      }
    }
  }
  return undefined;
}

function byService<Shape extends Record<ServiceName, unknown>>(
  build: (service: ServiceContract) => Shape[ServiceName],
): Shape {
  return Object.fromEntries(SERVICES.map((service) => [service.name, build(service)])) as Shape;
}

export function worldUrls(
  origin: (host: ServiceHost) => string,
  services: readonly string[],
): WorldUrls {
  return byService<WorldUrls>((service) =>
    services.includes(service.name) ? service.urlsFor(origin) : null,
  );
}

export function worldServices(origin: (host: ServiceHost) => string, services: readonly string[]) {
  return SERVICES.filter((service) => services.includes(service.name)).map((service) => ({
    name: service.name,
    title: service.title,
    ui_url: service.uiUrl(origin),
  }));
}

export const worldUiDescription =
  "The world's main page: the UI of its first service. Each service's own URLs are under its name.";

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

export const urlsShape = byService<{
  [Name in ServiceName]: z.ZodNullable<Contract<Name>["urls"]>;
}>((service) =>
  service.urls.nullable().openapi({ description: `null when the world has no ${service.title}.` }),
);

export const WorldServiceSchema = z
  .object({
    name: z.enum(SERVICE_NAMES),
    title: z.string().openapi({ example: SERVICES[0].title }),
    ui_url: z.url().openapi({ description: "The service's UI in this world." }),
  })
  .openapi("WorldService", { description: "A service in a world." });

export const specShape = byService<{
  [Name in ServiceName]: z.ZodOptional<Contract<Name>["spec"]>;
}>((service) => service.spec.optional());

export const stateShape = byService<{
  [Name in ServiceName]: z.ZodNullable<Contract<Name>["state"]>;
}>((service) => service.state.nullable());

export const createdShape = byService<Record<ServiceName, z.ZodType>>((service) =>
  service.urls
    .extend({ spec: service.state })
    .openapi(`${service.title}Created`, {
      description: `The world's ${service.title} URLs and effective spec.`,
    })
    .nullable()
    .openapi({ description: `null when the world has no ${service.title}.` }),
);

export function withSpecs(urls: WorldUrls, states: WorldStates) {
  return byService<Record<ServiceName, Record<string, unknown> | null>>((service) => {
    const serviceUrls = urls[service.name];
    return serviceUrls ? { ...serviceUrls, spec: states[service.name] } : null;
  });
}
