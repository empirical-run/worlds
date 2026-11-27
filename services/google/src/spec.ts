import type { z } from "@hono/zod-openapi";

import type { GoogleSpecSchema, GoogleStateSchema } from "./contract";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
export const PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile";

export const SCOPES = [DRIVE_FILE_SCOPE, EMAIL_SCOPE, PROFILE_SCOPE] as const;

export const SCOPE_ALIASES: Record<string, string> = {
  email: EMAIL_SCOPE,
  profile: PROFILE_SCOPE,
};

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DOCUMENT_MIME = "application/vnd.google-apps.document";
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const PRESENTATION_MIME = "application/vnd.google-apps.presentation";

export const EDITOR_MIMES: readonly string[] = [DOCUMENT_MIME, SPREADSHEET_MIME, PRESENTATION_MIME];

export const ROLES = ["reader", "writer"] as const;

export type ShareRole = (typeof ROLES)[number];

export type GoogleSpec = z.output<typeof GoogleSpecSchema>;

export type GoogleState = z.output<typeof GoogleStateSchema>;

export type GoogleUserState = GoogleState["users"][number];

export type GoogleAppState = GoogleState["apps"][number];

export function isEditorMime(mimeType: string): boolean {
  return EDITOR_MIMES.includes(mimeType);
}

export function googleSpecProblems(spec: GoogleSpec): string[] {
  const problems: string[] = [];
  const duplicate = (values: string[]) =>
    values.find((value, index) => values.indexOf(value) !== index);
  const users = spec.users;
  const emails = new Set(users.map((user) => user.email));
  const duplicateEmail = duplicate(users.map((user) => user.email));
  if (duplicateEmail) {
    problems.push(`users: duplicate email ${duplicateEmail}`);
  }
  const apps = spec.apps ?? [];
  const duplicateApp = duplicate(apps.map((app) => app.name));
  if (duplicateApp) {
    problems.push(`apps: duplicate name ${duplicateApp}`);
  }
  const duplicateClient = duplicate(
    apps.flatMap((app) => (app.credentials?.client_id ? [app.credentials.client_id] : [])),
  );
  if (duplicateClient) {
    problems.push(`apps: duplicate client_id ${duplicateClient}`);
  }
  const files = spec.files ?? [];
  const ids = files.flatMap((file) => (file.id ? [file.id] : []));
  const duplicateId = duplicate(ids);
  if (duplicateId) {
    problems.push(`files: duplicate id ${duplicateId}`);
  }
  const folders = new Set(
    files.flatMap((file) => (file.id && file.mime_type === FOLDER_MIME ? [file.id] : [])),
  );
  for (const [index, file] of files.entries()) {
    if (!emails.has(file.owner)) {
      problems.push(`files[${index}].owner: unknown user ${file.owner}`);
    }
    if (file.parent && !folders.has(file.parent)) {
      problems.push(`files[${index}].parent: no folder with id ${file.parent}`);
    }
    if (file.id && inCycle(file.id, files)) {
      problems.push(`files[${index}].parent: folders can't contain themselves`);
    }
    if (file.mime_type === FOLDER_MIME && file.content !== undefined) {
      problems.push(`files[${index}].content: folders have no content`);
    }
    for (const share of file.shared_with ?? []) {
      if (!emails.has(share.user)) {
        problems.push(`files[${index}].shared_with: unknown user ${share.user}`);
      }
    }
  }
  const appNames = new Set(apps.map((app) => app.name));
  const fileIds = new Set(ids);
  for (const [index, grant] of (spec.grants ?? []).entries()) {
    if (!appNames.has(grant.app)) {
      problems.push(`grants[${index}].app: unknown app ${grant.app}`);
    }
    if (!emails.has(grant.user)) {
      problems.push(`grants[${index}].user: unknown user ${grant.user}`);
    }
    if (!fileIds.has(grant.file)) {
      problems.push(`grants[${index}].file: no file with id ${grant.file}`);
    }
  }
  return problems;
}

function inCycle(id: string, files: NonNullable<GoogleSpec["files"]>): boolean {
  const parentOf = new Map(files.flatMap((file) => (file.id ? [[file.id, file.parent]] : [])));
  const seen = new Set<string>();
  let current = parentOf.get(id);
  while (current && !seen.has(current)) {
    if (current === id) {
      return true;
    }
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
}
