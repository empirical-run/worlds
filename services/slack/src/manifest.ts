import { z } from "@hono/zod-openapi";

const required = { error: "Field is required" };
const stringList = z.array(z.string(), { error: "Must be an array of strings" }).optional();
const url = z.url({ error: "Must be a URL" }).optional();

export const SlackManifestSchema = z
  .looseObject({
    display_information: z.looseObject(
      { name: z.string(required).trim().min(1, required), description: z.string().optional() },
      required,
    ),
    features: z
      .looseObject({
        bot_user: z
          .looseObject({
            display_name: z.string().optional(),
            always_online: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    oauth_config: z
      .looseObject({
        redirect_urls: stringList,
        scopes: z.looseObject({ bot: stringList, user: stringList }).optional(),
      })
      .optional(),
    settings: z
      .looseObject({
        event_subscriptions: z.looseObject({ request_url: url, bot_events: stringList }).optional(),
        interactivity: z
          .looseObject({ is_enabled: z.boolean().optional(), request_url: url })
          .optional(),
      })
      .optional(),
  })
  .openapi("SlackManifest", {
    description:
      "A Slack app manifest (JSON). Its redirect_urls, scopes, event_subscriptions and interactivity apply in this world.",
    example: {
      display_information: { name: "My app" },
      features: { bot_user: { display_name: "my-app" } },
      oauth_config: { scopes: { bot: ["app_mentions:read", "chat:write", "channels:history"] } },
      settings: {
        event_subscriptions: {
          request_url: "https://example.com/slack/events",
          bot_events: ["app_mention"],
        },
      },
    },
  });

export type SlackManifest = z.output<typeof SlackManifestSchema>;

export const SlackCredentialsSchema = z
  .object({
    client_id: z.string(),
    client_secret: z.string(),
    signing_secret: z.string(),
    verification_token: z.string(),
  })
  .openapi("SlackCredentials");

export type SlackCredentials = z.output<typeof SlackCredentialsSchema>;

export type ManifestProblem = { message: string; pointer: string };

export function validateManifest(
  value: unknown,
): { manifest: SlackManifest } | { problems: ManifestProblem[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { problems: [{ message: "Manifest must be a JSON object", pointer: "/" }] };
  const parsed = SlackManifestSchema.safeParse(value);
  if (parsed.success) return { manifest: parsed.data };
  return {
    problems: parsed.error.issues.map((issue) => ({
      message: issue.message,
      pointer: `/${issue.path.join("/")}`,
    })),
  };
}
