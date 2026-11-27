import { createRoute, z } from "@hono/zod-openapi";
import {
  defineService,
  errorResponse,
  jsonResponse,
  security,
  worldServer,
} from "@worlds/contract";

import { FOLDER_MIME, ROLES, googleSpecProblems } from "./spec";

const email = z.email().openapi({ example: "alice@acme.test" });

const userRef = email.openapi({ description: "A user's email address." });

const fileId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,64}$/, { error: "file ids are 10-64 letters, digits, _ and -" })
  .openapi({ example: "1dwGSHHV1RDwiK_bqmhKntR3zEsUksqfP" });

const GoogleUserSpecSchema = z
  .object({
    email,
    name: z.string().trim().min(1).max(200).openapi({ example: "Alice Tester" }),
  })
  .openapi("GoogleUserSpec", { description: "A Google account with its own My Drive." });

const GoogleCredentialsSchema = z
  .object({
    client_id: z.string().min(8).max(200),
    client_secret: z.string().min(16).max(256),
    api_key: z.string().min(16).max(256).openapi({
      description: "The API key the app passes to the Picker as its developer key.",
    }),
  })
  .openapi("GoogleCredentials", {
    description: "The app's OAuth client id and secret, and its API key.",
  });

const redirectUri = z.string().regex(/^https?:\/\/[^\s*]+$/);

const GoogleAppSpecSchema = z
  .object({
    name: z.string().min(1).max(80).openapi({ example: "My app" }),
    project_number: z
      .string()
      .regex(/^[0-9]{6,15}$/)
      .optional()
      .openapi({
        description:
          "The Cloud project number: the Picker's appId and the prefix of the client id. Generated if left out.",
        example: "622449777375",
      }),
    redirect_uris: z
      .array(redirectUri)
      .min(1)
      .max(100)
      .openapi({
        description: "Authorized redirect URIs. redirect_uri must equal one of them exactly.",
        example: ["http://localhost:5555/oauth/callback"],
      }),
    credentials: GoogleCredentialsSchema.partial()
      .openapi("GoogleCredentialsSpec", {
        description: "Pin the client id, secret and API key, e.g. to match ones your app has.",
      })
      .optional(),
  })
  .openapi("GoogleAppSpec", {
    description:
      "An OAuth web client in a Cloud project, in Testing mode with every user a test user.",
  });

const GoogleShareSpecSchema = z
  .object({ user: userRef, role: z.enum(ROLES) })
  .openapi("GoogleShareSpec", { description: "Someone the file is shared with." });

const GoogleFileSpecSchema = z
  .object({
    id: fileId.optional().openapi({
      description:
        "Pin the file id, to put files in this folder or grant it. Generated if left out.",
    }),
    name: z.string().min(1).max(500).openapi({ example: "notes.txt" }),
    mime_type: z
      .string()
      .min(3)
      .max(200)
      .openapi({
        description: `A MIME type; ${FOLDER_MIME} for a folder, application/vnd.google-apps.document for a Google Doc.`,
        example: "text/plain",
      }),
    owner: userRef,
    parent: fileId.optional().openapi({
      description:
        "The id of a folder in this spec. Left out, the file is in the owner's My Drive.",
    }),
    content: z.string().max(1_000_000).optional().openapi({
      description:
        "Text content; for a Google Doc, Sheet or Slides file the text that export returns.",
    }),
    shared_with: z.array(GoogleShareSpecSchema).max(50).optional(),
  })
  .openapi("GoogleFileSpec", { description: "A file or folder in someone's Drive." });

const GoogleGrantSpecSchema = z
  .object({
    app: z.string().openapi({ description: "An app's name." }),
    user: userRef,
    file: fileId.openapi({ description: "A pinned file id from files." }),
  })
  .openapi("GoogleGrantSpec", {
    description: "A drive.file grant, as if the user had picked the file in the app's Picker.",
  });

export const GoogleSpecSchema = z
  .object({
    users: z.array(GoogleUserSpecSchema).min(1).max(100),
    apps: z.array(GoogleAppSpecSchema).max(10).optional(),
    files: z.array(GoogleFileSpecSchema).max(1000).optional(),
    grants: z.array(GoogleGrantSpecSchema).max(1000).optional(),
  })
  .openapi("GoogleSpec", {
    description:
      "The world's Google accounts, Drive files, OAuth apps and drive.file grants. Omitted ids and credentials are generated. Leave it out to create the world without Google.",
  });

const GoogleUserStateSchema = z
  .object({
    id: z.string().openapi({ description: "The user's permission id and OpenID sub." }),
    email: z.string(),
    name: z.string(),
    root_folder_id: z.string().openapi({ description: "The id of the user's My Drive." }),
  })
  .openapi("GoogleUserState", { description: "A user, with its ids." });

const GoogleAppStateSchema = z
  .object({
    name: z.string(),
    project_number: z.string(),
    redirect_uris: z.array(z.string()),
    credentials: GoogleCredentialsSchema,
  })
  .openapi("GoogleAppState", { description: "An app, with its project number and credentials." });

const GoogleFileStateSchema = GoogleFileSpecSchema.omit({ content: true })
  .extend({ id: z.string() })
  .openapi("GoogleFileState", { description: "A file from the spec, with its id." });

export const GoogleStateSchema = z
  .object({
    users: z.array(GoogleUserStateSchema),
    apps: z.array(GoogleAppStateSchema),
    files: z.array(GoogleFileStateSchema),
    grants: z.array(GoogleGrantSpecSchema),
  })
  .openapi("GoogleState", {
    description: "The world's Google spec with every generated id and credential filled in.",
  });

const GoogleUrlsSchema = z
  .object({
    accounts_url: z.url().openapi({
      description:
        "In place of https://accounts.google.com (/o/oauth2/v2/auth), https://apis.google.com (/js/api.js loads the Picker) and https://drive.google.com and https://docs.google.com (file pages).",
      example: "https://k2v9x0q1m4-google.makeworlds.dev",
    }),
    api_url: z.url().openapi({
      description:
        "In place of https://oauth2.googleapis.com (/token, /revoke, /tokeninfo) and https://www.googleapis.com (/drive/v3, /upload/drive/v3, /oauth2/v3/userinfo).",
      example: "https://k2v9x0q1m4-google-api.makeworlds.dev",
    }),
  })
  .openapi("GoogleUrls", {
    description: "The world's Google URLs, one for the browser and one for APIs.",
  });

const GoogleFileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    mime_type: z.string(),
    owner: z.string().openapi({ description: "The owner's email." }),
    parent: z
      .string()
      .nullable()
      .openapi({ description: "The folder id; My Drive's id at the top." }),
    size: z
      .number()
      .nullable()
      .openapi({ description: "Bytes; null for folders and Google Docs files." }),
    trashed: z.boolean(),
    shared_with: z.array(GoogleShareSpecSchema),
    created_at: z.string(),
    modified_at: z.string(),
  })
  .openapi("GoogleFile", { description: "A file as the world stores it." });

const GoogleWorldStateSchema = z
  .object({
    spec: GoogleStateSchema,
    files: z.array(GoogleFileSchema),
    grants: z.array(GoogleGrantSpecSchema).openapi({
      description:
        "Every drive.file grant now: from the spec, Picker picks and files apps created.",
    }),
  })
  .openapi("GoogleWorldState", { description: "The world's Google as it is now." });

const GoogleFileCreateSchema = z
  .object({
    owner: userRef,
    name: z.string().min(1).max(500),
    mime_type: z.string().min(3).max(200),
    parent: z.string().optional().openapi({ description: "A folder id. Left out, My Drive." }),
    content: z.string().max(1_000_000).optional(),
    shared_with: z.array(GoogleShareSpecSchema).max(50).optional(),
  })
  .openapi("GoogleFileCreate", { description: "A file to add to someone's Drive, as that user." });

const GoogleGrantCreateSchema = z
  .object({
    app: z.string().openapi({ description: "An app's name or client id." }),
    user: userRef,
    file: z.string().openapi({ description: "A file id the user can see." }),
  })
  .openapi("GoogleGrantCreate", {
    description:
      "A drive.file grant to add, as if the user had picked the file in the app's Picker.",
  });

const servers = [worldServer("google")];
const tags = ["Google Drive world"];
const unauthorized = errorResponse("Missing or invalid credentials, or not your team's world");

export const googleStateRoute = createRoute({
  method: "get",
  path: "/_worlds/google/state",
  tags,
  servers,
  security,
  summary: "Get the Google world's state",
  description: "The spec with generated ids filled in, every file and every drive.file grant.",
  responses: {
    200: jsonResponse("The world's Google state", GoogleWorldStateSchema),
    401: unauthorized,
  },
});

export const createFileRoute = createRoute({
  method: "post",
  path: "/_worlds/google/files",
  tags,
  servers,
  security,
  summary: "Add a file",
  description:
    "Adds a file or folder to a user's Drive as that user. No app gets a grant for it, as when someone uploads in drive.google.com.",
  request: {
    body: { required: true, content: { "application/json": { schema: GoogleFileCreateSchema } } },
  },
  responses: {
    201: jsonResponse("The new file", GoogleFileSchema),
    400: errorResponse("Invalid fields, an unknown user or a parent that isn't their folder"),
    401: unauthorized,
  },
});

export const createGrantRoute = createRoute({
  method: "post",
  path: "/_worlds/google/grants",
  tags,
  servers,
  security,
  summary: "Grant a file to an app",
  description:
    "Gives the app drive.file access to the file for the user, as picking it in the app's Picker does.",
  request: {
    body: { required: true, content: { "application/json": { schema: GoogleGrantCreateSchema } } },
  },
  responses: {
    201: jsonResponse("The grant", GoogleGrantSpecSchema),
    400: errorResponse("An unknown app or user, or a file the user can't see"),
    401: unauthorized,
  },
});

export const google = defineService({
  name: "google",
  title: "Google Drive",
  hosts: ["google", "google-api"],
  spec: GoogleSpecSchema,
  state: GoogleStateSchema,
  urls: GoogleUrlsSchema,
  specProblems: googleSpecProblems,
  starter: {
    users: [{ email: "alice@acme.test", name: "Alice Tester" }],
  },
  uiUrl: (origin) => origin("google"),
  urlsFor: (origin) => ({ accounts_url: origin("google"), api_url: origin("google-api") }),
  routes: [googleStateRoute, createFileRoute, createGrantRoute],
});

export type GoogleHost = (typeof google.hosts)[number];

export function isGoogleHost(host: string): host is GoogleHost {
  return google.hosts.some((candidate) => candidate === host);
}
