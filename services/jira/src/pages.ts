import { projectByKey, userByAccountId, type Adf, type Comment, type Issue } from "./model";
import type { IssueStatus, JiraAppState, JiraState, JiraUserState } from "./spec";

const STYLE = `
:root {
  color-scheme: light;
  --text: #172b4d; --subtle: #44546f; --subtlest: #626f86; --border: #dcdfe4; --surface: #ffffff; --sunken: #f7f8f9;
  --hover: #091e420f; --selected-bg: #e9f2ff; --selected-text: #0c66e4; --link: #0c66e4; --brand: #0c66e4; --brand-hover: #0055cc;
  --todo-bg: #dcdfe4; --todo-text: #44546f; --progress-bg: #cce0ff; --progress-text: #0055cc; --done-bg: #baf3db; --done-text: #216e4e;
  --label-bg: #091e420f; --on-brand: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, "Helvetica Neue", sans-serif;
  font-size: 14px; line-height: 20px; color: var(--text); background: var(--surface);
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --text: #b6c2cf; --subtle: #9fadbc; --subtlest: #8c9bab; --border: #a6c5e229; --surface: #1d2125; --sunken: #161a1d;
    --hover: #a1bdd914; --selected-bg: #1c2b41; --selected-text: #579dff; --link: #579dff; --brand: #579dff; --brand-hover: #85b8ff;
    --todo-bg: #a1bdd914; --todo-text: #9fadbc; --progress-bg: #09326c; --progress-text: #85b8ff; --done-bg: #164b35; --done-text: #7ee2b8;
    --label-bg: #a1bdd914; --on-brand: #1d2125;
  }
}
* { box-sizing: border-box; }
body { margin: 0; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.topbar { height: 56px; display: flex; align-items: center; gap: 12px; padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--surface); position: sticky; top: 0; z-index: 1; }
.product { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 16px; color: var(--text); }
.product-mark { width: 24px; height: 24px; border-radius: 4px; background: var(--brand); display: grid; place-items: center; color: var(--on-brand); font-size: 13px; font-weight: 700; }
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: calc(100vh - 56px - var(--worlds-banner-height, 0px)); }
.sidebar { border-right: 1px solid var(--border); background: var(--surface); padding: 16px 8px; }
.project { display: flex; align-items: center; gap: 10px; padding: 8px; margin-bottom: 12px; }
.project-avatar { width: 32px; height: 32px; border-radius: 4px; background: #6e5dc6; color: #fff; display: grid; place-items: center; font-weight: 600; flex-shrink: 0; }
.project-name { font-weight: 600; }
.project-type { font-size: 12px; color: var(--subtlest); line-height: 16px; }
.nav-heading { font-size: 11px; font-weight: 700; color: var(--subtlest); text-transform: uppercase; letter-spacing: 0.04em; padding: 12px 8px 4px; }
.nav-item { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 8px; border-radius: 4px; color: var(--text); }
.nav-item:hover { background: var(--hover); text-decoration: none; }
.nav-item.selected { background: var(--selected-bg); color: var(--selected-text); font-weight: 500; }
.content { padding: 24px 40px 48px; min-width: 0; }
.breadcrumbs { color: var(--subtle); font-size: 14px; margin-bottom: 16px; display: flex; gap: 8px; align-items: center; }
.breadcrumbs a { color: var(--subtle); }
.breadcrumbs .sep { color: var(--subtlest); }
h1 { font-size: 24px; line-height: 28px; font-weight: 500; margin: 0 0 24px; }
table { border-collapse: collapse; width: 100%; }
th { text-align: left; font-size: 12px; font-weight: 600; color: var(--subtle); padding: 8px; border-bottom: 2px solid var(--border); white-space: nowrap; }
td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tbody tr:hover { background: var(--hover); }
td.key { white-space: nowrap; }
td.summary { width: 100%; }
td.nowrap { white-space: nowrap; color: var(--subtle); }
td.labels { white-space: nowrap; }
.type-icon { width: 16px; height: 16px; border-radius: 3px; background: #4bade8; display: inline-grid; place-items: center; vertical-align: middle; flex-shrink: 0; }
.type-icon::after { content: ""; width: 7px; height: 4px; border-left: 2px solid #fff; border-bottom: 2px solid #fff; transform: rotate(-45deg) translate(1px, -1px); }
.key-cell { display: inline-flex; align-items: center; gap: 8px; }
.lozenge { display: inline-block; font-size: 11px; font-weight: 700; line-height: 16px; text-transform: uppercase; padding: 0 4px; border-radius: 3px; white-space: nowrap; }
.lozenge.todo { background: var(--todo-bg); color: var(--todo-text); }
.lozenge.progress { background: var(--progress-bg); color: var(--progress-text); }
.lozenge.done { background: var(--done-bg); color: var(--done-text); }
.label { display: inline-block; font-size: 12px; line-height: 20px; padding: 0 6px; border-radius: 3px; background: var(--label-bg); color: var(--text); margin: 2px 4px 2px 0; }
.avatar { width: 24px; height: 24px; border-radius: 50%; color: #fff; display: inline-grid; place-items: center; font-size: 11px; font-weight: 600; flex-shrink: 0; }
.avatar.large { width: 32px; height: 32px; font-size: 13px; }
.person { display: inline-flex; align-items: center; gap: 8px; }
.muted { color: var(--subtlest); }
.empty { padding: 48px 0; text-align: center; color: var(--subtle); }
.issue { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 32px; align-items: start; }
.section-title { font-size: 16px; font-weight: 600; margin: 24px 0 8px; }
.prose p { margin: 0 0 12px; white-space: pre-wrap; }
.activity-tabs { display: flex; gap: 4px; margin: 4px 0 16px; }
.tab { font-size: 14px; padding: 4px 8px; border-radius: 3px; color: var(--subtle); }
.tab.selected { background: var(--selected-bg); color: var(--selected-text); font-weight: 500; }
.comment { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; margin-bottom: 20px; }
.comment-meta { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
.comment-author { font-weight: 600; }
.status-button { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border-radius: 3px; font-weight: 500; margin-bottom: 16px; }
.status-button.todo { background: var(--todo-bg); color: var(--text); }
.status-button.progress { background: var(--brand); color: var(--on-brand); }
.status-button.done { background: #1f845a; color: #fff; }
.details { border: 1px solid var(--border); border-radius: 4px; }
.details-header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid var(--border); }
.details-row { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px; padding: 8px 16px; align-items: center; min-height: 40px; }
.details-row .name { color: var(--subtle); font-weight: 600; font-size: 12px; }
.timestamps { color: var(--subtlest); font-size: 12px; margin-top: 12px; line-height: 18px; }
.card { max-width: 480px; margin: 64px auto; padding: 32px 40px; border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 8px 12px #091e4226, 0 0 1px #091e424f; background: var(--surface); }
.card h1 { font-size: 20px; line-height: 24px; text-align: center; margin-bottom: 8px; }
.card .centered { text-align: center; }
.consent-icons { display: flex; justify-content: center; align-items: center; gap: 12px; margin-bottom: 20px; }
.app-icon { width: 48px; height: 48px; border-radius: 8px; background: var(--sunken); border: 1px solid var(--border); display: grid; place-items: center; font-weight: 700; font-size: 18px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--subtle); margin: 20px 0 6px; }
.choice { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 6px; cursor: pointer; }
.choice:has(input:checked) { border-color: var(--brand); background: var(--selected-bg); }
.scopes { margin: 0; padding: 0; list-style: none; }
.scopes li { padding: 6px 0; border-bottom: 1px solid var(--border); }
.scopes li:last-child { border-bottom: none; }
.scope-code { display: block; font-size: 12px; color: var(--subtlest); }
.site-icon { width: 48px; height: 48px; border-radius: 8px; background: var(--brand); display: grid; place-content: center; gap: 4px; }
.site-icon span { display: block; height: 5px; border-radius: 3px; background: var(--on-brand); }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
button { font: inherit; font-weight: 500; height: 32px; padding: 0 12px; border-radius: 3px; border: none; cursor: pointer; background: var(--hover); color: var(--text); }
button.primary { background: var(--brand); color: var(--on-brand); }
button.primary:hover { background: var(--brand-hover); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .content { padding: 16px; }
  .issue { grid-template-columns: 1fr; gap: 16px; }
  .hide-narrow { display: none; }
}
`;

const AVATAR_COLORS = [
  "#1d7afc",
  "#6e5dc6",
  "#1f845a",
  "#c9372c",
  "#a54800",
  "#0055cc",
  "#943d73",
  "#216e4e",
];

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "read:jira-work": "View issues, projects and comments",
  "write:jira-work": "Create and edit issues and comments",
  "read:jira-user": "View user profiles",
  "manage:jira-webhook": "Register and manage webhooks",
  "manage:jira-project": "Manage projects",
  "manage:jira-configuration": "Manage site configuration",
  "read:me": "View your profile",
  offline_access: "Keep access when you're not using the app",
};

const STATUS_CLASS: Record<IssueStatus, string> = {
  "To Do": "todo",
  "In Progress": "progress",
  Done: "done",
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

function shell(state: JiraState, title: string, content: string, status = 200): Response {
  const project = state.projects[0];
  return page(
    `${title} - ${state.site.name}`,
    `<header class="topbar">
  <a class="product" href="/"><span class="product-mark">${escapeHtml(state.site.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(state.site.name)}</a>
</header>
<div class="layout">
  <nav class="sidebar">
    ${project ? `<div class="project"><span class="project-avatar">${escapeHtml(project.key.slice(0, 1))}</span><div><div class="project-name">${escapeHtml(project.name)}</div><div class="project-type">Software project</div></div></div>` : ""}
    <div class="nav-heading">Planning</div>
    <a class="nav-item selected" href="/">Issues</a>
  </nav>
  <main class="content">${content}</main>
</div>`,
    status,
  );
}

function user(state: JiraState, accountId: string | null): JiraUserState | undefined {
  return accountId
    ? state.users.find((candidate) => candidate.account_id === accountId)
    : undefined;
}

function avatar(person: JiraUserState | undefined, size: "" | "large" = ""): string {
  if (!person) {
    return `<span class="avatar ${size}" style="background: var(--todo-bg); color: var(--subtle)">?</span>`;
  }
  const initials = person.display_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const color =
    AVATAR_COLORS[
      Array.from(person.account_id, (char) => char.charCodeAt(0)).reduce(
        (sum, code) => sum + code,
        0,
      ) % AVATAR_COLORS.length
    ];
  return `<span class="avatar ${size}" style="background: ${color}" title="${escapeHtml(person.display_name)}">${escapeHtml(initials)}</span>`;
}

function personCell(state: JiraState, accountId: string | null): string {
  const person = user(state, accountId);
  return person
    ? `<span class="person">${avatar(person)}${escapeHtml(person.display_name)}</span>`
    : `<span class="person">${avatar(undefined)}<span class="muted">Unassigned</span></span>`;
}

function lozenge(status: IssueStatus): string {
  return `<span class="lozenge ${STATUS_CLASS[status]}">${escapeHtml(status)}</span>`;
}

function labels(values: string[]): string {
  return values.length
    ? values.map((value) => `<span class="label">${escapeHtml(value)}</span>`).join("")
    : `<span class="muted">None</span>`;
}

function displayDate(ms: number): string {
  return (
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(ms) + " UTC"
  );
}

function adfToHtml(node: unknown): string {
  if (!node || typeof node !== "object") {
    return "";
  }
  const { type, text, content, marks, attrs } = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    marks?: { type?: string; attrs?: { href?: string } }[];
    attrs?: { href?: string };
  };
  const inner = (content ?? []).map(adfToHtml).join("");
  switch (type) {
    case "text": {
      let html = escapeHtml(text ?? "");
      for (const mark of marks ?? []) {
        if (mark.type === "strong") {
          html = `<strong>${html}</strong>`;
        }
        if (mark.type === "em") {
          html = `<em>${html}</em>`;
        }
        if (mark.type === "code") {
          html = `<code>${html}</code>`;
        }
        if (mark.type === "link" && mark.attrs?.href && /^https?:/i.test(mark.attrs.href)) {
          html = `<a href="${escapeHtml(mark.attrs.href)}">${html}</a>`;
        }
      }
      return html;
    }
    case "hardBreak":
      return "<br>";
    case "paragraph":
      return `<p>${inner}</p>`;
    case "inlineCard":
      return attrs?.href && /^https?:/i.test(attrs.href)
        ? `<a href="${escapeHtml(attrs.href)}">${escapeHtml(attrs.href)}</a>`
        : "";
    default:
      return inner;
  }
}

function prose(doc: Adf | null, empty: string): string {
  const html = doc ? adfToHtml(doc) : "";
  return html.replace(/<p><\/p>/g, "")
    ? `<div class="prose">${html}</div>`
    : `<p class="muted">${escapeHtml(empty)}</p>`;
}

export function errorPage(message: string, status = 400): Response {
  return page(
    "Something went wrong",
    `<div class="card"><h1>Something went wrong</h1><p class="centered">${escapeHtml(message)}</p></div>`,
    status,
  );
}

export function consentPage(
  state: JiraState,
  app: JiraAppState,
  params: URLSearchParams,
  scopes: string[],
): Response {
  const hidden = [...params.entries()]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  const users = state.users
    .map(
      (person, index) =>
        `<label class="choice"><input type="radio" name="account_id" value="${escapeHtml(person.account_id)}"${index === 0 ? " checked" : ""}>${avatar(person)}<span>${escapeHtml(person.display_name)} <span class="muted">${escapeHtml(person.email)}</span></span></label>`,
    )
    .join("");
  return page(
    `${app.name} is requesting access`,
    `<form class="card" method="post" action="/authorize">${hidden}
  <div class="consent-icons"><span class="app-icon">${escapeHtml(app.name.slice(0, 1).toUpperCase())}</span><span class="muted">⇄</span><span class="site-icon"><span style="width: 24px"></span><span style="width: 18px"></span><span style="width: 12px"></span></span></div>
  <h1>${escapeHtml(app.name)} is requesting access to your account</h1>
  <p class="centered muted">${escapeHtml(state.site.url.replace(/^https?:\/\//, ""))}</p>
  <div class="field-label">Continue as</div>
  ${users || '<p class="muted">This world has no users.</p>'}
  <div class="field-label">${escapeHtml(app.name)} would like to</div>
  <ul class="scopes">${scopes.map((scope) => `<li>${escapeHtml(SCOPE_DESCRIPTIONS[scope] ?? scope)}<span class="scope-code">${escapeHtml(scope)}</span></li>`).join("")}</ul>
  <div class="actions">
    <button type="submit" name="decision" value="deny">Cancel</button>
    <button class="primary" type="submit" name="decision" value="accept"${state.users.length ? "" : " disabled"}>Accept</button>
  </div>
</form>`,
  );
}

export function issueListPage(state: JiraState, issues: Issue[]): Response {
  const rows = [...issues]
    .sort((a, b) => b.updated - a.updated)
    .map(
      (issue) => `<tr>
  <td class="key"><span class="key-cell"><span class="type-icon" title="Task"></span><a href="/browse/${escapeHtml(issue.key)}">${escapeHtml(issue.key)}</a></span></td>
  <td class="summary"><a href="/browse/${escapeHtml(issue.key)}" style="color: var(--text)">${escapeHtml(issue.summary)}</a></td>
  <td>${lozenge(issue.status)}</td>
  <td class="hide-narrow nowrap">${personCell(state, issue.assignee)}</td>
  <td class="hide-narrow labels">${issue.labels.map((value) => `<span class="label">${escapeHtml(value)}</span>`).join("")}</td>
  <td class="hide-narrow nowrap">${displayDate(issue.updated)}</td>
</tr>`,
    )
    .join("");
  return shell(
    state,
    "Issues",
    `<div class="breadcrumbs"><span>Projects</span><span class="sep">/</span><span>${escapeHtml(state.site.name)}</span></div>
<h1>Issues</h1>
${
  issues.length
    ? `<table><thead><tr><th>Key</th><th>Summary</th><th>Status</th><th class="hide-narrow">Assignee</th><th class="hide-narrow">Labels</th><th class="hide-narrow">Updated</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">No issues yet. Create them with <code>POST /_worlds/jira/issues</code>.</div>'
}`,
  );
}

function commentHtml(state: JiraState, comment: Comment): string {
  const author = userByAccountId(state, comment.author);
  return `<div class="comment">${avatar(author, "large")}<div><div class="comment-meta"><span class="comment-author">${escapeHtml(author.display_name)}</span><span class="muted">${displayDate(comment.created)}</span></div>${prose(comment.body, "")}</div></div>`;
}

export function issuePage(state: JiraState, issue: Issue): Response {
  const project = projectByKey(state, issue.project);
  const comments = [...issue.comments]
    .reverse()
    .map((comment) => commentHtml(state, comment))
    .join("");
  return shell(
    state,
    `[${issue.key}] ${issue.summary}`,
    `<div class="breadcrumbs"><span>Projects</span><span class="sep">/</span><a href="/">${escapeHtml(project.name)}</a><span class="sep">/</span><span class="key-cell"><span class="type-icon" title="Task"></span><a href="/browse/${escapeHtml(issue.key)}">${escapeHtml(issue.key)}</a></span></div>
<div class="issue">
  <div>
    <h1>${escapeHtml(issue.summary)}</h1>
    <div class="section-title">Description</div>
    ${prose(issue.description, "Add a description...")}
    <div class="section-title">Activity</div>
    <div class="activity-tabs"><span class="tab selected">Comments</span></div>
    ${comments || '<p class="muted">No comments yet.</p>'}
  </div>
  <aside>
    <div class="status-button ${STATUS_CLASS[issue.status]}">${escapeHtml(issue.status)}</div>
    <div class="details">
      <div class="details-header">Details</div>
      <div class="details-row"><span class="name">Assignee</span>${personCell(state, issue.assignee)}</div>
      <div class="details-row"><span class="name">Reporter</span>${personCell(state, issue.reporter)}</div>
      <div class="details-row"><span class="name">Labels</span><span>${labels(issue.labels)}</span></div>
      <div class="details-row"><span class="name">Priority</span><span>Medium</span></div>
    </div>
    <div class="timestamps">Created ${displayDate(issue.created)}<br>Updated ${displayDate(issue.updated)}</div>
  </aside>
</div>`,
  );
}
