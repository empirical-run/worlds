import { OpenAPIHono, z, type RouteConfig } from "@hono/zod-openapi";
import type { Env } from "hono";

const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string().openapi({ example: "No team with that id is visible to you." }),
    }),
  })
  .openapi("ApiError");

export type ApiError = z.infer<typeof ApiErrorSchema>;

export function apiError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export const security: Record<string, string[]>[] = [{ bearerAuth: [] }, { sessionCookie: [] }];

export function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ApiErrorSchema } } };
}

export function jsonResponse<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}

export function routes<E extends Env>() {
  return new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (result.success) return;
      const issue = result.error.issues[0];
      const path = issue?.path.join(".");
      const message = issue ? `${path ? `${path}: ` : ""}${issue.message}` : "Invalid request.";
      return c.json(apiError("invalid_request", message), 400);
    },
  });
}

const WORLD_SERVER_DOMAIN = "makeworlds.dev";

export function worldServer(host: string) {
  return {
    url: `https://{world}-${host}.${WORLD_SERVER_DOMAIN}`,
    description: "{world} is the world id without its world_ prefix, as in the world's URLs.",
    variables: {
      world: { default: "k2v9x0q1m4", description: "The world id without its world_ prefix." },
    },
  };
}

export const userRef = z
  .string()
  .min(1, { error: "user is required." })
  .openapi({ description: "A user's name or id.", example: "alice" });

type ServiceDefinition<
  Name extends string,
  Host extends string,
  Spec extends z.ZodType,
  State extends z.ZodType,
  Urls extends z.ZodObject,
> = {
  name: Name;
  title: string;
  hosts: readonly Host[];
  spec: Spec;
  state: State;
  urls: Urls;
  specProblems(spec: z.output<Spec>): string[];
  urlsFor(origin: (host: Host) => string): z.output<Urls>;
  uiUrl(origin: (host: Host) => string): string;
  routes: readonly RouteConfig[];
};

export function defineService<
  Name extends string,
  Host extends string,
  Spec extends z.ZodType,
  State extends z.ZodType,
  Urls extends z.ZodObject,
>(definition: ServiceDefinition<Name, Host, Spec, State, Urls>) {
  return {
    ...definition,
    problems(value: unknown): string[] {
      const parsed = definition.spec.safeParse(value);
      return parsed.success
        ? definition.specProblems(parsed.data)
        : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    },
  };
}
