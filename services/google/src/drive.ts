import { Hono } from "hono";

import { applyFields, parseFields, unknownField, type FieldMask } from "./fields";
import type { FileRecord } from "./model";
import { parseQuery } from "./query";
import type { AppContext, Env } from "./service";
import { FOLDER_MIME, isEditorMime } from "./spec";
import type { Bearer, GoogleWorld } from "./world";

const FILE_FIELDS: ReadonlySet<string> = new Set([
  "kind",
  "id",
  "name",
  "mimeType",
  "description",
  "starred",
  "trashed",
  "explicitlyTrashed",
  "parents",
  "properties",
  "appProperties",
  "spaces",
  "version",
  "webContentLink",
  "webViewLink",
  "iconLink",
  "hasThumbnail",
  "thumbnailLink",
  "thumbnailVersion",
  "viewedByMe",
  "viewedByMeTime",
  "createdTime",
  "modifiedTime",
  "modifiedByMeTime",
  "modifiedByMe",
  "sharedWithMeTime",
  "sharingUser",
  "owners",
  "teamDriveId",
  "driveId",
  "lastModifyingUser",
  "shared",
  "ownedByMe",
  "capabilities",
  "viewersCanCopyContent",
  "copyRequiresWriterPermission",
  "writersCanShare",
  "permissions",
  "permissionIds",
  "hasAugmentedPermissions",
  "folderColorRgb",
  "originalFilename",
  "fullFileExtension",
  "fileExtension",
  "md5Checksum",
  "sha1Checksum",
  "sha256Checksum",
  "size",
  "quotaBytesUsed",
  "headRevisionId",
  "contentHints",
  "imageMediaMetadata",
  "videoMediaMetadata",
  "isAppAuthorized",
  "exportLinks",
  "shortcutDetails",
  "contentRestrictions",
  "resourceKey",
  "linkShareMetadata",
  "labelInfo",
  "trashedTime",
  "trashingUser",
  "inheritedPermissionsDisabled",
  "downloadRestrictions",
]);

const LIST_FIELDS: ReadonlySet<string> = new Set([
  "kind",
  "nextPageToken",
  "incompleteSearch",
  "files",
]);

const ABOUT_FIELDS: ReadonlySet<string> = new Set([
  "kind",
  "user",
  "storageQuota",
  "importFormats",
  "exportFormats",
  "maxImportSizes",
  "maxUploadSize",
  "appInstalled",
  "folderColorPalette",
  "driveThemes",
  "canCreateDrives",
  "canCreateTeamDrives",
  "teamDriveThemes",
]);

const DEFAULT_FILE_FIELDS = "kind,id,name,mimeType";

const EXPORTS: Record<string, readonly string[]> = {
  "application/vnd.google-apps.document": ["text/plain", "text/markdown", "text/html"],
  "application/vnd.google-apps.spreadsheet": ["text/csv", "text/tab-separated-values"],
  "application/vnd.google-apps.presentation": ["text/plain"],
};

type DriveError = {
  code: number;
  message: string;
  reason: string;
  location?: string;
  locationType?: string;
  status?: string;
  detail?: string;
};

function errorBody({ code, message, reason, location, locationType, status, detail }: DriveError) {
  return {
    error: {
      code,
      message,
      errors: [
        {
          message: detail ?? message,
          domain: "global",
          reason,
          ...(location ? { location, locationType } : {}),
        },
      ],
      ...(status ? { status } : {}),
    },
  };
}

function fail(c: AppContext, error: DriveError): Response {
  return c.json(errorBody(error), error.code as 400);
}

const notFound = (id: string): DriveError => ({
  code: 404,
  message: `File not found: ${id}.`,
  reason: "notFound",
  location: "fileId",
  locationType: "parameter",
});

const insufficientFile: DriveError = {
  code: 403,
  message: "The user does not have sufficient permissions for this file.",
  reason: "insufficientFilePermissions",
};

const invalidValue = (location: string): DriveError => ({
  code: 400,
  message: "Invalid Value",
  reason: "invalid",
  location,
  locationType: "parameter",
});

function authenticate(c: AppContext): Bearer | Response {
  const world = c.get("world");
  const bearer = world.bearer(
    c.req.header("authorization") ??
      (c.req.query("access_token") ? `Bearer ${c.req.query("access_token")}` : null),
  );
  if (bearer === "missing") {
    return fail(c, {
      code: 401,
      message:
        "Request is missing required authentication credential. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.",
      reason: "required",
      location: "Authorization",
      locationType: "header",
      status: "UNAUTHENTICATED",
      detail: "Login Required.",
    });
  }
  if (bearer === "invalid") {
    return fail(c, {
      code: 401,
      message:
        "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.",
      reason: "authError",
      location: "Authorization",
      locationType: "header",
      status: "UNAUTHENTICATED",
      detail: "Invalid Credentials",
    });
  }
  if (!world.canUseDrive(bearer)) {
    return fail(c, {
      code: 403,
      message: "Request had insufficient authentication scopes.",
      reason: "insufficientPermissions",
      status: "PERMISSION_DENIED",
      detail: "Insufficient Permission",
    });
  }
  return bearer;
}

function fieldsOf(
  c: AppContext,
  fallback: string,
  known: ReadonlySet<string>,
  nested?: { key: string; known: ReadonlySet<string> },
): FieldMask | Response {
  const raw = c.req.query("fields") ?? fallback;
  const mask = parseFields(raw);
  if (!mask) {
    return fail(c, {
      code: 400,
      message: `Invalid field selection ${raw}`,
      reason: "invalidParameter",
      location: "fields",
      locationType: "parameter",
    });
  }
  const unknown =
    unknownField(mask, known) ??
    (nested && mask.get(nested.key) instanceof Map
      ? unknownField(mask.get(nested.key) as FieldMask, nested.known)
      : null);
  if (unknown) {
    return fail(c, {
      code: 400,
      message: `Invalid field selection ${unknown}`,
      reason: "invalidParameter",
      location: "fields",
      locationType: "parameter",
    });
  }
  return mask;
}

function accessible(c: AppContext, bearer: Bearer, id: string): FileRecord | Response {
  const world = c.get("world");
  const file = world.file(id);
  if (!file || !world.appCanSee(bearer, file)) {
    return fail(c, notFound(id));
  }
  return file;
}

function sendFile(
  c: AppContext,
  world: GoogleWorld,
  bearer: Bearer,
  file: FileRecord,
  status: 200 | 201 = 200,
): Response {
  const mask = fieldsOf(c, DEFAULT_FILE_FIELDS, FILE_FIELDS);
  if (mask instanceof Response) {
    return mask;
  }
  return c.json(applyFields(world.resource(file, bearer), mask) as Record<string, unknown>, status);
}

const SORT_KEYS: Record<string, (file: FileRecord) => string | number> = {
  name: (file) => file.name.toLowerCase(),
  name_natural: (file) => file.name.toLowerCase(),
  modifiedTime: (file) => file.modified,
  modifiedByMeTime: (file) => file.modified,
  viewedByMeTime: (file) => file.modified,
  createdTime: (file) => file.created,
  folder: (file) => (file.mime_type === FOLDER_MIME ? 0 : 1),
  quotaBytesUsed: (file) => file.size ?? 0,
  recency: (file) => file.modified,
};

function comparator(
  orderBy: string | undefined,
): ((a: FileRecord, b: FileRecord) => number) | null {
  const keys = (orderBy ?? "modifiedTime desc")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const steps: { read: (file: FileRecord) => string | number; desc: boolean }[] = [];
  for (const key of keys) {
    const [name, direction] = key.split(/\s+/);
    const read = name ? SORT_KEYS[name] : undefined;
    if (!read || (direction && !/^(asc|desc)$/i.test(direction))) {
      return null;
    }
    steps.push({ read, desc: direction?.toLowerCase() === "desc" });
  }
  return (a, b) => {
    for (const { read, desc } of steps) {
      const left = read(a);
      const right = read(b);
      if (left !== right) {
        return (left < right ? -1 : 1) * (desc ? -1 : 1);
      }
    }
    return 0;
  };
}

type Multipart = { metadata: Record<string, unknown>; content: Uint8Array; contentType: string };

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let index = from; index <= haystack.length - needle.length; index++) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) {
        continue outer;
      }
    }
    return index;
  }
  return -1;
}

function parseMultipart(bytes: Uint8Array, contentType: string): Multipart | null {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!boundary) {
    return null;
  }
  const encoder = new TextEncoder();
  const delimiter = encoder.encode(`--${boundary}`);
  const headerEnd = encoder.encode("\r\n\r\n");
  const parts: { headers: string; body: Uint8Array }[] = [];
  let position = indexOf(bytes, delimiter, 0);
  while (position !== -1) {
    const start = position + delimiter.length;
    if (bytes[start] === 45 && bytes[start + 1] === 45) {
      break;
    }
    const next = indexOf(bytes, delimiter, start);
    if (next === -1) {
      return null;
    }
    const part = bytes.slice(start + 2, next - 2);
    const split = indexOf(part, headerEnd, 0);
    if (split === -1) {
      return null;
    }
    parts.push({
      headers: new TextDecoder().decode(part.slice(0, split)),
      body: part.slice(split + 4),
    });
    position = next;
  }
  const [meta, media] = parts;
  if (!meta) {
    return null;
  }
  try {
    const metadata = JSON.parse(new TextDecoder().decode(meta.body)) as Record<string, unknown>;
    return {
      metadata,
      content: media?.body ?? new Uint8Array(),
      contentType:
        /content-type:\s*([^\r\n;]+)/i.exec(media?.headers ?? "")?.[1]?.trim() ??
        "application/octet-stream",
    };
  } catch {
    return null;
  }
}

async function readUpload(c: AppContext, withContent: boolean): Promise<Multipart | DriveError> {
  const contentType = c.req.header("content-type") ?? "";
  if (!withContent) {
    const metadata = contentType.includes("json")
      ? ((await c.req.json().catch(() => null)) as Record<string, unknown> | null)
      : {};
    return metadata && typeof metadata === "object"
      ? { metadata, content: new Uint8Array(), contentType: "" }
      : invalidValue("body");
  }
  const uploadType = c.req.query("uploadType") ?? "media";
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (uploadType === "multipart") {
    return (
      parseMultipart(bytes, contentType) ?? {
        code: 400,
        message: "Malformed multipart body.",
        reason: "badContent",
      }
    );
  }
  if (uploadType === "media") {
    return {
      metadata: {},
      content: bytes,
      contentType: contentType.split(";")[0]?.trim() || "application/octet-stream",
    };
  }
  return {
    code: 400,
    message: `Invalid upload type: ${uploadType}. This world supports media and multipart.`,
    reason: "badRequest",
    location: "uploadType",
    locationType: "parameter",
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function createFile(c: AppContext, withContent: boolean): Promise<Response> {
  const bearer = authenticate(c);
  if (bearer instanceof Response) {
    return bearer;
  }
  const world = c.get("world");
  const upload = await readUpload(c, withContent);
  if ("code" in upload) {
    return fail(c, upload);
  }
  const { metadata } = upload;
  const parents = Array.isArray(metadata.parents)
    ? metadata.parents.filter((parent): parent is string => typeof parent === "string")
    : [];
  if (parents.length > 1) {
    return fail(c, {
      code: 403,
      message: "Increasing the number of parents is not allowed.",
      reason: "cannotAddParent",
    });
  }
  const parent = world.parentFor(parents[0] ?? "root", bearer.user);
  const problem = world.parentProblem(parent, bearer.user);
  if (problem === "not_found") {
    return fail(c, notFound(parent));
  }
  if (problem === "forbidden") {
    return fail(c, insufficientFile);
  }
  const mimeType =
    asString(metadata.mimeType) ?? (withContent ? upload.contentType : "application/octet-stream");
  if (mimeType === FOLDER_MIME && upload.content.byteLength) {
    return fail(c, { code: 400, message: "Folders can't have content.", reason: "badContent" });
  }
  const file = await world.createFile(bearer.user, {
    name: asString(metadata.name) ?? "Untitled",
    mime_type: mimeType,
    parent,
    description: asString(metadata.description),
    content: mimeType === FOLDER_MIME ? undefined : upload.content,
  });
  world.grant(bearer.app, bearer.user, file);
  return sendFile(c, world, bearer, file);
}

async function updateFile(c: AppContext, withContent: boolean): Promise<Response> {
  const bearer = authenticate(c);
  if (bearer instanceof Response) {
    return bearer;
  }
  const world = c.get("world");
  const file = accessible(c, bearer, c.req.param("id") ?? "");
  if (file instanceof Response) {
    return file;
  }
  const role = world.role(file, bearer.user.id);
  if (role !== "owner" && role !== "writer") {
    return fail(c, insufficientFile);
  }
  const upload = await readUpload(c, withContent);
  if ("code" in upload) {
    return fail(c, upload);
  }
  const { metadata } = upload;
  if ("parents" in metadata) {
    return fail(c, {
      code: 403,
      message:
        "The parents field is not directly writable in update requests. Use the addParents and removeParents parameters instead.",
      reason: "fieldNotWritable",
    });
  }
  const addParents = (c.req.query("addParents") ?? "").split(",").filter(Boolean);
  const removeParents = (c.req.query("removeParents") ?? "").split(",").filter(Boolean);
  if (addParents.length > 1 || (addParents.length === 1 && !removeParents.includes(file.parent))) {
    return fail(c, {
      code: 403,
      message: "Increasing the number of parents is not allowed.",
      reason: "cannotAddParent",
    });
  }
  if (addParents[0]) {
    const parent = world.parentFor(addParents[0], bearer.user);
    const problem = world.parentProblem(parent, bearer.user);
    if (problem) {
      return fail(c, problem === "not_found" ? notFound(parent) : insufficientFile);
    }
    file.parent = parent;
  }
  if (typeof metadata.trashed === "boolean") {
    if (role !== "owner") {
      return fail(c, insufficientFile);
    }
    file.trashed = metadata.trashed;
  }
  const name = asString(metadata.name);
  if (name !== undefined) {
    file.name = name;
  }
  const description = asString(metadata.description);
  if (description !== undefined) {
    file.description = description;
  }
  if (withContent) {
    if (file.mime_type === FOLDER_MIME) {
      return fail(c, { code: 400, message: "Folders can't have content.", reason: "badContent" });
    }
    await world.writeContent(file, upload.content);
  } else {
    world.touch(file);
  }
  return sendFile(c, world, bearer, file);
}

function decodePageToken(token: string): number {
  try {
    return Number(atob(token.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return Number.NaN;
  }
}

export function drive(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/drive/v3/about", (c) => {
    const bearer = authenticate(c);
    if (bearer instanceof Response) {
      return bearer;
    }
    if (!c.req.query("fields")) {
      return fail(c, {
        code: 400,
        message: "The 'fields' parameter is required for this method.",
        reason: "required",
        location: "fields",
        locationType: "parameter",
      });
    }
    const mask = fieldsOf(c, "", ABOUT_FIELDS);
    if (mask instanceof Response) {
      return mask;
    }
    const world = c.get("world");
    return c.json(
      applyFields(
        {
          kind: "drive#about",
          user: world.driveUser(bearer.user.id, bearer.user.id),
          storageQuota: world.storageQuota(bearer.user.id),
          appInstalled: false,
          maxUploadSize: "5242880000000",
          canCreateDrives: false,
        },
        mask,
      ) as Record<string, unknown>,
      200,
    );
  });

  app.get("/drive/v3/files", (c) => {
    const bearer = authenticate(c);
    if (bearer instanceof Response) {
      return bearer;
    }
    const world = c.get("world");
    const mask = fieldsOf(
      c,
      "kind,incompleteSearch,nextPageToken,files(kind,id,name,mimeType)",
      LIST_FIELDS,
      { key: "files", known: FILE_FIELDS },
    );
    if (mask instanceof Response) {
      return mask;
    }
    const test = parseQuery(c.req.query("q") ?? "", {
      rootId: bearer.user.root_folder_id,
      ownerEmail: (userId) => world.user(userId)?.email,
    });
    if (!test) {
      return fail(c, invalidValue("q"));
    }
    const compare = comparator(c.req.query("orderBy"));
    if (!compare) {
      return fail(c, invalidValue("orderBy"));
    }
    const pageSize = Number(c.req.query("pageSize") ?? 100);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
      return fail(c, invalidValue("pageSize"));
    }
    const pageToken = c.req.query("pageToken");
    const offset = pageToken ? decodePageToken(pageToken) : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      return fail(c, invalidValue("pageToken"));
    }
    const matching = world.data.files
      .filter((file) => world.appCanSee(bearer, file) && test(file))
      .sort(compare);
    const page = matching.slice(offset, offset + pageSize);
    const next =
      offset + pageSize < matching.length
        ? btoa(String(offset + pageSize))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
        : undefined;
    return c.json(
      applyFields(
        {
          kind: "drive#fileList",
          ...(next ? { nextPageToken: next } : {}),
          incompleteSearch: false,
          files: page.map((file) => world.resource(file, bearer)),
        },
        mask,
      ) as Record<string, unknown>,
      200,
    );
  });

  app.post("/drive/v3/files", (c) => createFile(c, false));
  app.post("/upload/drive/v3/files", (c) => createFile(c, true));
  app.patch("/drive/v3/files/:id", (c) => updateFile(c, false));
  app.patch("/upload/drive/v3/files/:id", (c) => updateFile(c, true));
  app.put("/upload/drive/v3/files/:id", (c) => updateFile(c, true));

  app.get("/drive/v3/files/:id", async (c) => {
    const bearer = authenticate(c);
    if (bearer instanceof Response) {
      return bearer;
    }
    const world = c.get("world");
    const file = accessible(c, bearer, c.req.param("id"));
    if (file instanceof Response) {
      return file;
    }
    if (c.req.query("alt") !== "media") {
      return sendFile(c, world, bearer, file);
    }
    if (file.mime_type === FOLDER_MIME || isEditorMime(file.mime_type)) {
      return fail(c, {
        code: 403,
        message:
          "Only files with binary content can be downloaded. Use Export with Docs Editors files.",
        reason: "fileNotDownloadable",
        location: "alt",
        locationType: "parameter",
      });
    }
    const bytes = (await world.content.get(file.id)) ?? new Uint8Array();
    return new Response(bytes, {
      headers: { "content-type": file.mime_type, "content-length": String(bytes.byteLength) },
    });
  });

  app.get("/drive/v3/files/:id/export", async (c) => {
    const bearer = authenticate(c);
    if (bearer instanceof Response) {
      return bearer;
    }
    const world = c.get("world");
    const id = c.req.param("id");
    const file = world.file(id);
    if (!file || world.role(file, bearer.user.id) === null) {
      return fail(c, notFound(id));
    }
    if (!world.isGranted(bearer.app.credentials.client_id, bearer.user.id, file.id)) {
      return fail(c, {
        code: 403,
        message: `The user has not granted the app ${bearer.app.project_number} read access to the file ${file.id}.`,
        reason: "appNotAuthorizedToFile",
        location: "Authorization",
        locationType: "header",
      });
    }
    const formats = EXPORTS[file.mime_type];
    if (!formats) {
      return fail(c, {
        code: 403,
        message: "Export only supports Docs Editors files.",
        reason: "fileNotExportable",
      });
    }
    const mimeType = c.req.query("mimeType");
    if (!mimeType) {
      return fail(c, {
        code: 400,
        message: "Required parameter: mimeType",
        reason: "required",
        location: "mimeType",
        locationType: "parameter",
      });
    }
    if (!formats.includes(mimeType)) {
      return fail(c, {
        code: 400,
        message: "The requested conversion is not supported.",
        reason: "badRequest",
        location: "convertTo",
        locationType: "parameter",
      });
    }
    const text = new TextDecoder().decode((await world.content.get(file.id)) ?? new Uint8Array());
    const body =
      mimeType === "text/html"
        ? `<html><head><meta content="text/html; charset=UTF-8" http-equiv="content-type"></head><body>${text
            .split("\n")
            .map((line) => `<p>${line.replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`)}</p>`)
            .join("")}</body></html>`
        : text;
    return new Response(body, { headers: { "content-type": `${mimeType}; charset=utf-8` } });
  });

  app.delete("/drive/v3/files/:id", async (c) => {
    const bearer = authenticate(c);
    if (bearer instanceof Response) {
      return bearer;
    }
    const world = c.get("world");
    const file = accessible(c, bearer, c.req.param("id"));
    if (file instanceof Response) {
      return file;
    }
    if (world.role(file, bearer.user.id) !== "owner") {
      return fail(c, insufficientFile);
    }
    await world.deleteFile(file);
    return c.body(null, 204);
  });

  return app;
}
