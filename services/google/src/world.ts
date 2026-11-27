import {
  digits,
  isoDate,
  md5Hex,
  newFileId,
  newRootId,
  randomId,
  type AccessToken,
  type FileRecord,
  type GoogleData,
  type Origins,
  type Role,
  type Share,
} from "./model";
import {
  DRIVE_FILE_SCOPE,
  EMAIL_SCOPE,
  FOLDER_MIME,
  PROFILE_SCOPE,
  SCOPES,
  SCOPE_ALIASES,
  isEditorMime,
  type GoogleAppState,
  type GoogleSpec,
  type GoogleUserState,
} from "./spec";

const CODE_LIFETIME_MS = 10 * 60_000;
const ACCESS_LIFETIME_S = 3599;
const TESTING_REFRESH_LIFETIME_S = 604_799;

export type ContentStore = {
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array): Promise<void>;
  delete(ids: string[]): Promise<void>;
};

export type OAuthError = { error: string; error_description: string; status: 400 | 401 };

export type AuthorizeCheck =
  | { app: GoogleAppState; scopes: string[]; redirectUri: string; offline: boolean }
  | { error: string; description: string; status: 400 | 401 };

export type FileInput = {
  name: string;
  mime_type: string;
  parent: string;
  description?: string;
  content?: Uint8Array;
  shares?: Share[];
};

export type Bearer = { token: AccessToken; user: GoogleUserState; app: GoogleAppState };

export class GoogleWorld {
  constructor(
    readonly data: GoogleData,
    readonly origins: Origins,
    readonly content: ContentStore,
  ) {}

  get state() {
    return this.data.state;
  }

  user(ref: string | null | undefined): GoogleUserState | undefined {
    return this.state.users.find((user) => user.email === ref || user.id === ref);
  }

  userByRoot(rootId: string): GoogleUserState | undefined {
    return this.state.users.find((user) => user.root_folder_id === rootId);
  }

  app(ref: string | null | undefined): GoogleAppState | undefined {
    return this.state.apps.find((app) => app.name === ref || app.credentials.client_id === ref);
  }

  appByApiKey(key: string | null | undefined): GoogleAppState | undefined {
    return this.state.apps.find((app) => app.credentials.api_key === key);
  }

  appByProject(projectNumber: string | null | undefined): GoogleAppState | undefined {
    return this.state.apps.find((app) => app.project_number === projectNumber);
  }

  file(id: string): FileRecord | undefined {
    return this.data.files.find((file) => file.id === id);
  }

  checkAuthorize(params: URLSearchParams): AuthorizeCheck {
    const app = this.state.apps.find(
      (candidate) => candidate.credentials.client_id === params.get("client_id"),
    );
    if (!app) {
      return {
        error: "invalid_client",
        description: "The OAuth client was not found.",
        status: 401,
      };
    }
    const redirectUri = params.get("redirect_uri") ?? "";
    if (!app.redirect_uris.includes(redirectUri)) {
      return {
        error: "redirect_uri_mismatch",
        description: `You can't sign in to this app because it doesn't comply with Google's OAuth 2.0 policy. Request details: redirect_uri=${redirectUri}`,
        status: 400,
      };
    }
    if (params.get("response_type") !== "code") {
      return {
        error: "unsupported_response_type",
        description: "This world's Google supports only response_type=code.",
        status: 400,
      };
    }
    const requested = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);
    if (requested.length === 0) {
      return {
        error: "invalid_request",
        description: "Missing required parameter: scope",
        status: 400,
      };
    }
    const scopes = [...new Set(requested.map((scope) => SCOPE_ALIASES[scope] ?? scope))];
    const unsupported = scopes.filter((scope) => !SCOPES.some((known) => known === scope));
    if (unsupported.length) {
      return {
        error: "invalid_scope",
        description: `Some requested scopes aren't supported in this world: ${unsupported.join(", ")}. Supported: drive.file, email and profile.`,
        status: 400,
      };
    }
    return { app, scopes, redirectUri, offline: params.get("access_type") === "offline" };
  }

  issueCode(
    app: GoogleAppState,
    user: GoogleUserState,
    scopes: string[],
    redirectUri: string,
    offline: boolean,
  ): string {
    const code = `4/0${randomId(70)}`;
    this.data.codes.push({
      code,
      client_id: app.credentials.client_id,
      user_id: user.id,
      scopes,
      redirect_uri: redirectUri,
      offline,
      expires_at: Date.now() + CODE_LIFETIME_MS,
    });
    return code;
  }

  clientFor(clientId: string | undefined, secret: string | undefined): GoogleAppState | OAuthError {
    const app = this.state.apps.find((candidate) => candidate.credentials.client_id === clientId);
    if (!app) {
      return {
        error: "invalid_client",
        error_description: "The OAuth client was not found.",
        status: 401,
      };
    }
    if (app.credentials.client_secret !== secret) {
      return { error: "invalid_client", error_description: "Unauthorized", status: 401 };
    }
    return app;
  }

  exchangeCode(app: GoogleAppState, code: string, redirectUri: string) {
    const index = this.data.codes.findIndex((candidate) => candidate.code === code);
    const issued = this.data.codes[index];
    if (
      !issued ||
      issued.client_id !== app.credentials.client_id ||
      issued.expires_at < Date.now()
    ) {
      return badGrant("Bad Request");
    }
    if (issued.redirect_uri !== redirectUri) {
      return {
        error: "redirect_uri_mismatch",
        error_description: "Bad Request",
        status: 400,
      } as const;
    }
    this.data.codes.splice(index, 1);
    const refresh = issued.offline ? this.issueRefresh(issued) : null;
    const access = this.issueAccess(issued, refresh?.token ?? null);
    return {
      access_token: access.token,
      expires_in: ACCESS_LIFETIME_S,
      ...(refresh
        ? {
            refresh_token: refresh.token,
            refresh_token_expires_in: secondsLeft(refresh.expires_at),
          }
        : {}),
      scope: issued.scopes.join(" "),
      token_type: "Bearer",
    };
  }

  refresh(app: GoogleAppState, token: string) {
    const refresh = this.data.refresh_tokens.find((candidate) => candidate.token === token);
    if (!refresh || refresh.expires_at < Date.now()) {
      return badGrant("Token has been expired or revoked.");
    }
    if (refresh.client_id !== app.credentials.client_id) {
      return {
        error: "unauthorized_client",
        error_description: "Unauthorized",
        status: 401,
      } as const;
    }
    const access = this.issueAccess({ ...refresh, offline: true }, refresh.token);
    return {
      access_token: access.token,
      expires_in: ACCESS_LIFETIME_S,
      refresh_token_expires_in: secondsLeft(refresh.expires_at),
      scope: refresh.scopes.join(" "),
      token_type: "Bearer",
    };
  }

  revoke(token: string): boolean {
    const found =
      this.data.access_tokens.find((candidate) => candidate.token === token) ??
      this.data.refresh_tokens.find((candidate) => candidate.token === token);
    if (!found) {
      return false;
    }
    const other = (entry: { client_id: string; user_id: string }) =>
      entry.client_id !== found.client_id || entry.user_id !== found.user_id;
    this.data.access_tokens = this.data.access_tokens.filter(other);
    this.data.refresh_tokens = this.data.refresh_tokens.filter(other);
    this.data.codes = this.data.codes.filter(other);
    return true;
  }

  bearer(header: string | undefined | null): Bearer | "missing" | "invalid" {
    const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) {
      return "missing";
    }
    return this.accessToken(token) ?? "invalid";
  }

  accessToken(token: string): Bearer | undefined {
    const access = this.data.access_tokens.find((candidate) => candidate.token === token);
    if (!access || access.expires_at < Date.now()) {
      return undefined;
    }
    const user = this.user(access.user_id);
    const app = this.app(access.client_id);
    return user && app ? { token: access, user, app } : undefined;
  }

  tokenInfo(bearer: Bearer) {
    const scopes = bearer.token.scopes;
    const withEmail = scopes.includes(EMAIL_SCOPE);
    return {
      azp: bearer.app.credentials.client_id,
      aud: bearer.app.credentials.client_id,
      ...(withEmail || scopes.includes(PROFILE_SCOPE) ? { sub: bearer.user.id } : {}),
      scope: scopes.join(" "),
      exp: String(Math.floor(bearer.token.expires_at / 1000)),
      expires_in: String(secondsLeft(bearer.token.expires_at)),
      ...(withEmail ? { email: bearer.user.email, email_verified: "true" } : {}),
      access_type: bearer.token.offline ? "offline" : "online",
    };
  }

  userInfo(bearer: Bearer) {
    const scopes = bearer.token.scopes;
    const [given, ...family] = bearer.user.name.split(" ");
    return {
      sub: bearer.user.id,
      ...(scopes.includes(PROFILE_SCOPE)
        ? {
            name: bearer.user.name,
            given_name: given,
            ...(family.length ? { family_name: family.join(" ") } : {}),
            picture: `${this.origins.accounts}/avatar/${bearer.user.id}.svg`,
          }
        : {}),
      ...(scopes.includes(EMAIL_SCOPE) ? { email: bearer.user.email, email_verified: true } : {}),
    };
  }

  parentVisible(file: FileRecord, viewer: GoogleUserState): boolean {
    if (file.parent === viewer.root_folder_id) {
      return true;
    }
    const parent = this.file(file.parent);
    return parent !== undefined && this.role(parent, viewer.id) !== null;
  }

  canUseDrive(bearer: Bearer): boolean {
    return bearer.token.scopes.includes(DRIVE_FILE_SCOPE);
  }

  role(file: FileRecord, userId: string, depth = 0): Role | null {
    if (file.owner === userId) {
      return "owner";
    }
    const share = file.shares.find((candidate) => candidate.user === userId);
    if (share) {
      return share.role;
    }
    const parent = this.file(file.parent);
    return parent && depth < 100 ? this.role(parent, userId, depth + 1) : null;
  }

  isGranted(clientId: string, userId: string, fileId: string): boolean {
    return this.data.grants.some(
      (grant) =>
        grant.client_id === clientId && grant.user_id === userId && grant.file_id === fileId,
    );
  }

  grant(app: GoogleAppState, user: GoogleUserState, file: FileRecord): void {
    if (!this.isGranted(app.credentials.client_id, user.id, file.id)) {
      this.data.grants.push({
        client_id: app.credentials.client_id,
        user_id: user.id,
        file_id: file.id,
      });
    }
  }

  appCanSee(bearer: Bearer, file: FileRecord): boolean {
    return (
      this.role(file, bearer.user.id) !== null &&
      this.isGranted(bearer.app.credentials.client_id, bearer.user.id, file.id)
    );
  }

  visibleFiles(userId: string): FileRecord[] {
    return this.data.files.filter((file) => this.role(file, userId) !== null);
  }

  parentFor(ref: string, user: GoogleUserState): string {
    return ref === "root" ? user.root_folder_id : ref;
  }

  parentProblem(parentId: string, user: GoogleUserState): "not_found" | "forbidden" | null {
    if (parentId === user.root_folder_id) {
      return null;
    }
    const folder = this.file(parentId);
    if (!folder || folder.mime_type !== FOLDER_MIME) {
      return "not_found";
    }
    const role = this.role(folder, user.id);
    if (role === null) {
      return "not_found";
    }
    return role === "reader" ? "forbidden" : null;
  }

  async createFile(
    owner: GoogleUserState,
    input: FileInput,
    id = newFileId(),
  ): Promise<FileRecord> {
    const now = Date.now();
    const folder = input.mime_type === FOLDER_MIME;
    const binary = !folder && !isEditorMime(input.mime_type);
    const bytes = folder ? undefined : (input.content ?? new Uint8Array());
    const file: FileRecord = {
      id,
      name: input.name,
      mime_type: input.mime_type,
      description: input.description ?? "",
      owner: owner.id,
      parent: input.parent,
      trashed: false,
      shares: input.shares ?? [],
      size: binary && bytes ? bytes.byteLength : null,
      md5: binary && bytes ? await md5Hex(bytes) : null,
      version: 1,
      created: now,
      modified: now,
    };
    this.data.files.push(file);
    if (bytes) {
      await this.content.put(file.id, bytes);
    }
    return file;
  }

  async writeContent(file: FileRecord, bytes: Uint8Array): Promise<void> {
    const binary = !isEditorMime(file.mime_type);
    file.size = binary ? bytes.byteLength : null;
    file.md5 = binary ? await md5Hex(bytes) : null;
    this.touch(file);
    await this.content.put(file.id, bytes);
  }

  touch(file: FileRecord): void {
    file.version += 1;
    file.modified = Math.max(Date.now(), file.modified + 1);
  }

  async deleteFile(file: FileRecord): Promise<void> {
    const doomed = new Set([file.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of this.data.files) {
        if (!doomed.has(candidate.id) && doomed.has(candidate.parent)) {
          doomed.add(candidate.id);
          grew = true;
        }
      }
    }
    this.data.files = this.data.files.filter((candidate) => !doomed.has(candidate.id));
    this.data.grants = this.data.grants.filter((grant) => !doomed.has(grant.file_id));
    await this.content.delete([...doomed]);
  }

  fileUrl(file: FileRecord, usp: "drivesdk" | "drive_web"): string {
    const base = this.origins.accounts;
    if (file.mime_type === FOLDER_MIME) {
      return `${base}/drive/folders/${file.id}`;
    }
    const kind = EDITOR_PATHS[file.mime_type];
    return kind
      ? `${base}/${kind}/d/${file.id}/edit?usp=${usp}`
      : `${base}/file/d/${file.id}/view?usp=${usp}`;
  }

  driveUser(userId: string, viewerId: string) {
    const user = this.user(userId);
    return {
      kind: "drive#user",
      displayName: user?.name ?? "",
      photoLink: `${this.origins.accounts}/avatar/${userId}.svg`,
      me: userId === viewerId,
      permissionId: userId,
      emailAddress: user?.email ?? "",
    };
  }

  resource(file: FileRecord, bearer: Bearer): Record<string, unknown> {
    const viewer = bearer.user;
    const role = this.role(file, viewer.id);
    const folder = file.mime_type === FOLDER_MIME;
    const editor = isEditorMime(file.mime_type);
    const canWrite = role === "owner" || role === "writer";
    const owned = role === "owner";
    const parentVisible = this.parentVisible(file, viewer);
    const extension = !folder && !editor ? file.name.match(/\.([^.]+)$/)?.[1] : undefined;
    return {
      kind: "drive#file",
      id: file.id,
      name: file.name,
      mimeType: file.mime_type,
      ...(file.description ? { description: file.description } : {}),
      starred: false,
      trashed: file.trashed,
      explicitlyTrashed: file.trashed,
      ...(parentVisible ? { parents: [file.parent] } : {}),
      spaces: ["drive"],
      version: String(file.version),
      webViewLink: this.fileUrl(file, "drivesdk"),
      ...(!folder && !editor
        ? { webContentLink: `${this.origins.accounts}/uc?id=${file.id}&export=download` }
        : {}),
      iconLink: `https://drive-thirdparty.googleusercontent.com/16/type/${file.mime_type}`,
      hasThumbnail: false,
      viewedByMe: true,
      createdTime: isoDate(file.created),
      modifiedTime: isoDate(file.modified),
      owners: [this.driveUser(file.owner, viewer.id)],
      lastModifyingUser: this.driveUser(file.owner, viewer.id),
      shared: file.shares.length > 0,
      ownedByMe: owned,
      capabilities: {
        canAddChildren: folder && canWrite,
        canComment: !folder,
        canCopy: !folder,
        canDelete: owned,
        canDownload: true,
        canEdit: canWrite,
        canListChildren: folder,
        canRename: canWrite,
        canShare: canWrite,
        canTrash: owned,
      },
      isAppAuthorized: this.isGranted(bearer.app.credentials.client_id, viewer.id, file.id),
      ...(extension
        ? { originalFilename: file.name, fullFileExtension: extension, fileExtension: extension }
        : {}),
      ...(file.md5 ? { md5Checksum: file.md5 } : {}),
      ...(file.size !== null ? { size: String(file.size) } : {}),
    };
  }

  pickerDoc(file: FileRecord, viewer: GoogleUserState, granted: boolean): Record<string, unknown> {
    const kind = PICKER_KINDS[file.mime_type] ?? { serviceId: "DoclistBlob", type: "file" };
    const base = this.origins.accounts;
    const folder = file.mime_type === FOLDER_MIME;
    const editorPath = EDITOR_PATHS[file.mime_type];
    const url = folder
      ? `${base}/drive/folders/${file.id}`
      : editorPath
        ? `${base}/${editorPath}/d/${file.id}/edit?usp=drive_web`
        : `${base}/file/d/${file.id}/view?usp=drive_web`;
    const embedUrl = folder
      ? `${base}/embeddedfolderview?id=${file.id}`
      : editorPath
        ? `${base}/${editorPath}/d/${file.id}/preview`
        : `${base}/file/d/${file.id}/preview?usp=drive_web`;
    const parentId = this.parentVisible(file, viewer) ? file.parent : undefined;
    return {
      id: file.id,
      serviceId: kind.serviceId,
      mimeType: file.mime_type,
      name: file.name,
      description: file.description,
      type: kind.type,
      lastEditedUtc: file.modified,
      iconUrl: `https://drive-thirdparty.googleusercontent.com/16/type/${file.mime_type}`,
      url,
      embedUrl,
      ...(granted ? { driveSuccess: true } : {}),
      ...(folder ? {} : { sizeBytes: file.size ?? 0 }),
      ...(parentId ? { parentId } : {}),
      ...(file.owner !== viewer.id || file.shares.length ? { isShared: true } : {}),
    };
  }

  storageQuota(userId: string) {
    const used = this.data.files
      .filter((file) => file.owner === userId)
      .reduce((total, file) => total + (file.size ?? 0), 0);
    const trashed = this.data.files
      .filter((file) => file.owner === userId && file.trashed)
      .reduce((total, file) => total + (file.size ?? 0), 0);
    return {
      limit: "16106127360",
      usage: String(used),
      usageInDrive: String(used),
      usageInDriveTrash: String(trashed),
    };
  }

  private issueRefresh(grant: { client_id: string; user_id: string; scopes: string[] }) {
    const refresh = {
      token: `1//0${randomId(100)}`,
      client_id: grant.client_id,
      user_id: grant.user_id,
      scopes: grant.scopes,
      expires_at: Date.now() + TESTING_REFRESH_LIFETIME_S * 1000,
    };
    this.data.refresh_tokens.push(refresh);
    return refresh;
  }

  private issueAccess(
    grant: { client_id: string; user_id: string; scopes: string[]; offline: boolean },
    refreshToken: string | null,
  ): AccessToken {
    const access: AccessToken = {
      token: `ya29.${randomId(160)}`,
      client_id: grant.client_id,
      user_id: grant.user_id,
      scopes: grant.scopes,
      offline: grant.offline,
      refresh_token: refreshToken,
      expires_at: Date.now() + ACCESS_LIFETIME_S * 1000,
    };
    this.data.access_tokens = this.data.access_tokens.filter(
      (candidate) => candidate.expires_at > Date.now(),
    );
    this.data.access_tokens.push(access);
    return access;
  }
}

const EDITOR_PATHS: Record<string, string> = {
  "application/vnd.google-apps.document": "document",
  "application/vnd.google-apps.spreadsheet": "spreadsheets",
  "application/vnd.google-apps.presentation": "presentation",
};

const PICKER_KINDS: Record<string, { serviceId: string; type: string }> = {
  [FOLDER_MIME]: { serviceId: "docs", type: "folder" },
  "application/vnd.google-apps.document": { serviceId: "doc", type: "document" },
  "application/vnd.google-apps.spreadsheet": { serviceId: "spread", type: "spreadsheet" },
  "application/vnd.google-apps.presentation": { serviceId: "pres", type: "presentation" },
};

function secondsLeft(expiresAt: number): number {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
}

function badGrant(description: string) {
  return { error: "invalid_grant", error_description: description, status: 400 } as const;
}

export function emptyData(spec: GoogleSpec): GoogleData {
  return {
    state: {
      users: spec.users.map((user) => ({
        id: digits(20),
        email: user.email,
        name: user.name,
        root_folder_id: newRootId(),
      })),
      apps: (spec.apps ?? []).map((app) => {
        const projectNumber = app.project_number ?? digits(12);
        return {
          name: app.name,
          project_number: projectNumber,
          redirect_uris: app.redirect_uris,
          credentials: {
            client_id:
              app.credentials?.client_id ??
              `${projectNumber}-${randomId(32, "abcdefghijklmnopqrstuvwxyz0123456789")}.apps.googleusercontent.com`,
            client_secret: app.credentials?.client_secret ?? `GOCSPX-${randomId(28)}`,
            api_key: app.credentials?.api_key ?? `AIza${randomId(35)}`,
          },
        };
      }),
      files: [],
      grants: spec.grants ?? [],
    },
    files: [],
    grants: [],
    codes: [],
    access_tokens: [],
    refresh_tokens: [],
  };
}

export async function seedFiles(world: GoogleWorld, spec: GoogleSpec): Promise<void> {
  const files = spec.files ?? [];
  const ids = files.map((file) => file.id ?? newFileId());
  const placed = new Set<number>();
  while (placed.size < files.length) {
    const before = placed.size;
    for (const [index, file] of files.entries()) {
      const ready = !file.parent || world.file(file.parent);
      if (placed.has(index) || !ready) {
        continue;
      }
      const owner = world.user(file.owner);
      if (!owner) {
        throw new Error(`google spec: unknown user ${file.owner}`);
      }
      await world.createFile(
        owner,
        {
          name: file.name,
          mime_type: file.mime_type,
          parent: file.parent ?? owner.root_folder_id,
          content: file.content === undefined ? undefined : new TextEncoder().encode(file.content),
          shares: (file.shared_with ?? []).map((share) => ({
            user: world.user(share.user)?.id ?? share.user,
            role: share.role,
          })),
        },
        ids[index],
      );
      world.state.files.push({
        id: ids[index]!,
        name: file.name,
        mime_type: file.mime_type,
        owner: file.owner,
        ...(file.parent ? { parent: file.parent } : {}),
        ...(file.shared_with ? { shared_with: file.shared_with } : {}),
      });
      placed.add(index);
    }
    if (placed.size === before) {
      throw new Error("google spec: files whose parents never appear");
    }
  }
  for (const grant of spec.grants ?? []) {
    const app = world.app(grant.app);
    const user = world.user(grant.user);
    const file = world.file(grant.file);
    if (app && user && file) {
      world.grant(app, user, file);
    }
  }
}
