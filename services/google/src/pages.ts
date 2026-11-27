import type { FileRecord } from "./model";
import {
  DRIVE_FILE_SCOPE,
  EMAIL_SCOPE,
  FOLDER_MIME,
  PROFILE_SCOPE,
  type GoogleAppState,
  type GoogleUserState,
} from "./spec";
import type { GoogleWorld } from "./world";

const STYLE = `
:root { color-scheme: light; --bg: #f0f4f9; --panel: #fff; --text: #1f1f1f; --muted: #444746; --faint: #747775; --border: #c4c7c5; --divider: #e1e3e1; --hover: #e9eef6; --accent: #0b57d0; --on-accent: #fff; --tonal: #d3e3fd; font: 14px/20px "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --bg: #131314; --panel: #1e1f20; --text: #e3e3e3; --muted: #c4c7c5; --faint: #8e918f; --border: #444746; --divider: #2d2f31; --hover: #282a2c; --accent: #a8c7fa; --on-accent: #062e6f; --tonal: #004a77; } }
* { box-sizing: border-box; }
body { margin: 0; }
a { color: var(--accent); text-decoration: none; }
.card { max-width: 1040px; margin: 40px auto; background: var(--panel); border-radius: 28px; padding: 36px 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
.brand { font-size: 15px; color: var(--muted); display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
.g { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #fff; background: conic-gradient(#ea4335 0 25%, #fbbc05 0 50%, #34a853 0 75%, #4285f4 0); }
.card h1 { font-size: 32px; line-height: 40px; font-weight: 400; margin: 0 0 16px; }
.card .lead { color: var(--muted); font-size: 16px; line-height: 24px; }
.warning { border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; color: var(--muted); margin-top: 24px; font-size: 13px; }
.accounts { display: flex; flex-direction: column; gap: 8px; }
.account { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--divider); cursor: pointer; }
.account:hover { background: var(--hover); }
.account:has(input:checked) { border-color: var(--accent); background: var(--hover); }
.account input { accent-color: var(--accent); }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: #5e97f6; color: #fff; display: grid; place-items: center; font-weight: 500; flex-shrink: 0; }
.account .muted { color: var(--faint); font-size: 12px; }
.section { font-size: 14px; color: var(--muted); margin: 24px 0 8px; font-weight: 500; }
.scopes { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--divider); }
.scopes li { padding: 12px 0; border-bottom: 1px solid var(--divider); display: flex; gap: 12px; }
.scopes li::before { content: "✓"; color: var(--accent); font-weight: 700; }
.buttons { display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px; }
button { font: inherit; font-weight: 500; height: 40px; padding: 0 24px; border-radius: 20px; border: 0; cursor: pointer; background: transparent; color: var(--accent); }
button:hover { background: var(--hover); }
button.primary { background: var(--accent); color: var(--on-accent); }
button:disabled { opacity: .4; cursor: default; }
.error-card { max-width: 560px; margin: 64px auto; background: var(--panel); border-radius: 28px; padding: 36px 40px; }
.error-card h1 { font-size: 24px; font-weight: 400; margin: 16px 0 8px; }
.error-card code { font-size: 13px; color: var(--muted); word-break: break-all; }
.drive { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: calc(100vh - var(--worlds-banner-height, 0px)); }
.sidebar { padding: 16px 12px; }
.sidebar .logo { display: flex; align-items: center; gap: 10px; font-size: 22px; padding: 4px 12px 20px; color: var(--muted); }
.people a { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border-radius: 20px; color: var(--text); }
.people a:hover { background: var(--hover); }
.people a.selected { background: var(--tonal); font-weight: 500; }
.people .avatar { width: 24px; height: 24px; font-size: 12px; }
.main { background: var(--panel); border-radius: 16px; margin: 8px 16px 16px 0; padding: 16px 20px; min-width: 0; }
.main h2 { font-size: 22px; font-weight: 400; margin: 4px 0 16px; }
.crumbs { color: var(--muted); margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 500; color: var(--muted); font-size: 13px; padding: 8px; border-bottom: 1px solid var(--divider); }
td { padding: 10px 8px; border-bottom: 1px solid var(--divider); vertical-align: middle; }
td.name { display: flex; align-items: center; gap: 10px; min-width: 0; }
td.name a { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon { width: 20px; height: 20px; border-radius: 4px; display: inline-grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; flex-shrink: 0; background: #9aa0a6; }
.icon.folder { background: #5f6368; border-radius: 0; clip-path: polygon(0 18%, 38% 18%, 48% 30%, 100% 30%, 100% 88%, 0 88%); } .icon.document { background: #4285f4; } .icon.spreadsheet { background: #0f9d58; } .icon.presentation { background: #f4b400; }
.chip { display: inline-block; font-size: 12px; padding: 0 8px; border-radius: 8px; background: var(--tonal); margin: 2px 4px 2px 0; white-space: nowrap; }
.muted { color: var(--faint); }
.empty { color: var(--faint); padding: 32px 8px; }
pre { white-space: pre-wrap; background: var(--bg); padding: 16px; border-radius: 12px; overflow: auto; max-height: 70vh; }
@media (max-width: 760px) {
  .card { grid-template-columns: 1fr; margin: 0; border-radius: 0; padding: 24px 20px; gap: 16px; }
  .drive { grid-template-columns: 1fr; }
  .main { margin: 0 8px 8px; }
  .hide-narrow { display: none; }
}
`;

const SCOPE_TEXT: Record<string, string> = {
  [DRIVE_FILE_SCOPE]:
    "See, edit, create and delete only the specific Google Drive files that you use with this app",
  [EMAIL_SCOPE]: "See your primary Google Account email address",
  [PROFILE_SCOPE]:
    "See your personal info, including any personal info that you've made publicly available",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

function initial(text: string): string {
  return escapeHtml(text.trim().charAt(0).toUpperCase() || "?");
}

export function errorPage(error: string, description: string, status = 400): Response {
  return page(
    `Error ${status}: ${error}`,
    `<div class="error-card"><div class="brand"><span class="g">G</span>Sign in with Google</div><h1>Access blocked: this request is invalid</h1><p>${escapeHtml(description)}</p><p><code>Error ${status}: ${escapeHtml(error)}</code></p></div>`,
    status,
  );
}

export function consentPage(
  world: GoogleWorld,
  app: GoogleAppState,
  params: URLSearchParams,
  scopes: string[],
): Response {
  const hidden = [...params.entries()]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  const hint = params.get("login_hint");
  const accounts = world.state.users
    .map((user, index) => {
      const checked = hint ? user.email === hint : index === 0;
      return `<label class="account"><input type="radio" name="user_id" value="${escapeHtml(user.id)}"${checked ? " checked" : ""}><span class="avatar">${initial(user.name)}</span><span>${escapeHtml(user.name)}<br><span class="muted">${escapeHtml(user.email)}</span></span></label>`;
    })
    .join("");
  return page(
    `Sign in - Google Accounts`,
    `<form class="card" method="post" action="/o/oauth2/v2/auth">${hidden}
<div><div class="brand"><span class="g">G</span>Sign in with Google</div><h1>${escapeHtml(app.name)} wants access to your Google Account</h1><p class="lead">Choose an account to continue to ${escapeHtml(app.name)}.</p><div class="warning">Google hasn't verified this app. It is in Testing mode, so only its test users (everyone in this world) can sign in.</div></div>
<div><div class="accounts">${accounts}</div>
<div class="section">${escapeHtml(app.name)} will be able to:</div><ul class="scopes">${scopes.map((scope) => `<li>${escapeHtml(SCOPE_TEXT[scope] ?? scope)}</li>`).join("")}</ul>
<div class="buttons"><button type="submit" name="decision" value="deny">Cancel</button><button class="primary" type="submit" name="decision" value="accept">Continue</button></div></div>
</form>`,
  );
}

function kindOf(file: FileRecord): string {
  if (file.mime_type === FOLDER_MIME) {
    return "folder";
  }
  return file.mime_type.startsWith("application/vnd.google-apps.")
    ? file.mime_type.slice("application/vnd.google-apps.".length)
    : "file";
}

const ICON_LETTER: Record<string, string> = {
  document: "W",
  spreadsheet: "S",
  presentation: "P",
  folder: "",
  file: "F",
};

function fileIcon(file: FileRecord): string {
  const kind = kindOf(file);
  return `<span class="icon ${kind}">${ICON_LETTER[kind] ?? "F"}</span>`;
}

function grantChips(world: GoogleWorld, file: FileRecord, viewer: GoogleUserState): string {
  return world.state.apps
    .filter((app) => world.isGranted(app.credentials.client_id, viewer.id, file.id))
    .map((app) => `<span class="chip" title="drive.file grant">${escapeHtml(app.name)}</span>`)
    .join("");
}

function sidebar(world: GoogleWorld, viewer: GoogleUserState): string {
  const people = world.state.users
    .map(
      (user) =>
        `<a href="/?user=${encodeURIComponent(user.email)}"${user.id === viewer.id ? ' class="selected"' : ""}><span class="avatar">${initial(user.name)}</span>${escapeHtml(user.name)}</a>`,
    )
    .join("");
  return `<aside class="sidebar"><div class="logo"><span class="g">G</span>Drive</div><nav class="people" aria-label="Accounts">${people}</nav></aside>`;
}

export function drivePage(
  world: GoogleWorld,
  viewer: GoogleUserState,
  folderId: string | null,
): Response {
  const folder = folderId ? world.file(folderId) : undefined;
  if (folderId && (!folder || world.role(folder, viewer.id) === null)) {
    return notFoundPage();
  }
  const parentId = folder?.id ?? viewer.root_folder_id;
  const mine = world.data.files.filter(
    (file) => file.parent === parentId && world.role(file, viewer.id) !== null,
  );
  const shared = folder
    ? []
    : world.data.files.filter(
        (file) =>
          file.owner !== viewer.id &&
          world.role(file, viewer.id) !== null &&
          !world.parentVisible(file, viewer),
      );
  const rows = [...mine, ...shared]
    .sort(
      (a, b) =>
        Number(b.mime_type === FOLDER_MIME) - Number(a.mime_type === FOLDER_MIME) ||
        b.modified - a.modified,
    )
    .map((file) => {
      const href =
        file.mime_type === FOLDER_MIME
          ? `/drive/folders/${file.id}?user=${encodeURIComponent(viewer.email)}`
          : `/file/d/${file.id}/view?user=${encodeURIComponent(viewer.email)}`;
      const owner = file.owner === viewer.id ? "me" : (world.user(file.owner)?.name ?? "");
      return `<tr><td class="name">${fileIcon(file)}<a href="${href}">${escapeHtml(file.name)}</a>${file.trashed ? ' <span class="muted">(in trash)</span>' : ""}</td><td class="hide-narrow">${escapeHtml(owner)}</td><td class="hide-narrow muted">${new Date(file.modified).toISOString().slice(0, 10)}</td><td>${grantChips(world, file, viewer)}</td></tr>`;
    })
    .join("");
  const title = folder ? folder.name : "My Drive";
  const crumbs = folder
    ? `<div class="crumbs"><a href="/?user=${encodeURIComponent(viewer.email)}">My Drive</a> › ${escapeHtml(folder.name)}</div>`
    : "";
  return page(
    `${title} - Google Drive`,
    `<div class="drive">${sidebar(world, viewer)}<main class="main">${crumbs}<h2>${escapeHtml(title)}</h2>${
      rows
        ? `<table><thead><tr><th>Name</th><th class="hide-narrow">Owner</th><th class="hide-narrow">Last modified</th><th>Apps with access</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty">No files here yet.</div>'
    }</main></div>`,
  );
}

export function filePage(
  world: GoogleWorld,
  viewer: GoogleUserState,
  file: FileRecord,
  text: string | null,
): Response {
  return page(
    `${file.name} - Google Drive`,
    `<div class="drive">${sidebar(world, viewer)}<main class="main"><div class="crumbs"><a href="/?user=${encodeURIComponent(viewer.email)}">My Drive</a></div><h2>${fileIcon(file)} ${escapeHtml(file.name)}</h2><p class="muted">${escapeHtml(file.mime_type)}${file.size !== null ? ` · ${file.size} bytes` : ""} · Apps with access: ${grantChips(world, file, viewer) || "none"}</p>${
      text === null
        ? '<div class="empty">No preview for this file.</div>'
        : `<pre>${escapeHtml(text)}</pre>`
    }</main></div>`,
  );
}

export function notFoundPage(): Response {
  return page(
    "Google Drive - File not found",
    `<div class="error-card"><div class="brand"><span class="g">G</span>Drive</div><h1>Sorry, the file you have requested does not exist.</h1><p class="muted">Make sure that you have the correct URL and the file exists.</p></div>`,
    404,
  );
}

export function avatarSvg(name: string): Response {
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#5e97f6"/><text x="48" y="62" font-family="Roboto, sans-serif" font-size="44" fill="#fff" text-anchor="middle">${initial(name)}</text></svg>`,
    { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } },
  );
}
