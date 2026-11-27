import { z } from "@hono/zod-openapi";

const required = { error: "Field is required" };
const stringList = z.array(z.string(), { error: "Must be an array of strings" }).optional();
const url = z.url({ error: "Must be a URL" }).optional();

const SlackManifestDisplayInformationSchema = z
  .looseObject(
    {
      name: z.string(required).trim().min(1, required),
      description: z.string().optional(),
    },
    required,
  )
  .openapi("SlackManifestDisplayInformation", { description: "How the app shows in Slack." });

const SlackManifestBotUserSchema = z
  .looseObject({
    display_name: z.string().optional(),
    always_online: z.boolean().optional(),
  })
  .openapi("SlackManifestBotUser", { description: "The app's bot user." });

const SlackManifestFeaturesSchema = z
  .looseObject({ bot_user: SlackManifestBotUserSchema.optional() })
  .openapi("SlackManifestFeatures", { description: "The app's features." });

const SlackManifestScopesSchema = z
  .looseObject({ bot: stringList, user: stringList })
  .openapi("SlackManifestScopes", { description: "OAuth scopes the app asks for." });

const SlackManifestOAuthConfigSchema = z
  .looseObject({
    redirect_urls: stringList.openapi({
      description: "Allowed redirect_uri prefixes. A * in the host matches one label.",
    }),
    scopes: SlackManifestScopesSchema.optional(),
  })
  .openapi("SlackManifestOAuthConfig", { description: "How the app is installed over OAuth." });

const SlackManifestEventSubscriptionsSchema = z
  .looseObject({
    request_url: url.openapi({ description: "Where the world posts events." }),
    bot_events: stringList.openapi({ description: "Event types to send, such as app_mention." }),
  })
  .openapi("SlackManifestEventSubscriptions", { description: "The Events API subscription." });

const SlackManifestInteractivitySchema = z
  .looseObject({ is_enabled: z.boolean().optional(), request_url: url })
  .openapi("SlackManifestInteractivity", {
    description: "Where the world posts interactive payloads.",
  });

const SlackManifestSettingsSchema = z
  .looseObject({
    event_subscriptions: SlackManifestEventSubscriptionsSchema.optional(),
    interactivity: SlackManifestInteractivitySchema.optional(),
  })
  .openapi("SlackManifestSettings", { description: "Events and interactivity settings." });

export const SlackManifestSchema = z
  .looseObject({
    display_information: SlackManifestDisplayInformationSchema,
    features: SlackManifestFeaturesSchema.optional(),
    oauth_config: SlackManifestOAuthConfigSchema.optional(),
    settings: SlackManifestSettingsSchema.optional(),
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
  .openapi("SlackCredentials", { description: "The app's OAuth and request-signing credentials." });

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
