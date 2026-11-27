import type { Issue, Person } from "./model";
import type { IssueState, LinearAppState } from "./spec";
import type { LinearWorkspace } from "./workspace";

const STYLE = `
:root {
  color-scheme: light;
  --bg: #fcfcfd; --sidebar: #f4f5f8; --panel: #ffffff; --text: #282a30; --muted: #6b6f76; --faint: #9a9da3;
  --border: #e6e6e9; --hover: #eeeff2; --selected: #e6e7eb; --accent: #5e6ad2; --accent-hover: #4f5ac0; --on-accent: #ffffff;
  --started: #f2c94c; --done: #5e6ad2; --canceled: #95a2b3;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px; line-height: 20px; color: var(--text); background: var(--bg);
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #191a1f; --sidebar: #141519; --panel: #1f2025; --text: #e3e4e8; --muted: #8a8f98; --faint: #62666d;
    --border: #2a2b31; --hover: #24252b; --selected: #2c2d33; --accent: #7170ff; --accent-hover: #8483ff; --on-accent: #ffffff;
  }
}
* { box-sizing: border-box; }
body { margin: 0; }
a { color: inherit; text-decoration: none; }
.layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: calc(100vh - var(--worlds-banner-height, 0px)); }
.sidebar { background: var(--sidebar); border-right: 1px solid var(--border); padding: 12px 8px; }
.workspace { display: flex; align-items: center; gap: 8px; padding: 4px 8px 12px; font-weight: 600; }
.workspace-mark { width: 20px; height: 20px; border-radius: 5px; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; font-size: 11px; font-weight: 700; }
.nav-heading { font-size: 12px; color: var(--muted); padding: 12px 8px 4px; font-weight: 500; }
.nav-item { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; border-radius: 6px; color: var(--text); }
.nav-item:hover { background: var(--hover); }
.nav-item.selected { background: var(--selected); }
.team-mark { width: 16px; height: 16px; border-radius: 4px; background: #4ea7fc; color: #fff; display: grid; place-items: center; font-size: 9px; font-weight: 700; }
.main { min-width: 0; display: flex; flex-direction: column; }
.header { height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 24px; border-bottom: 1px solid var(--border); color: var(--muted); }
.header strong { color: var(--text); font-weight: 500; }
.group { display: flex; align-items: center; gap: 8px; padding: 0 24px; height: 36px; background: var(--sidebar); border-bottom: 1px solid var(--border); font-weight: 500; }
.group .count { color: var(--muted); font-weight: 400; }
.row { display: flex; align-items: center; gap: 12px; height: 40px; padding: 0 24px; border-bottom: 1px solid var(--border); }
.row:hover { background: var(--hover); }
.row .identifier { color: var(--muted); width: 64px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.row .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .date { color: var(--muted); font-size: 12px; flex-shrink: 0; }
.avatar { width: 18px; height: 18px; border-radius: 50%; background: #8a8f98; color: #fff; font-size: 9px; font-weight: 600; display: inline-grid; place-items: center; flex-shrink: 0; }
.avatar.app { border-radius: 5px; background: var(--accent); }
.avatar.empty { background: transparent; border: 1px dashed var(--faint); }
.status { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; display: inline-block; border: 1.5px solid var(--faint); }
.status.backlog { border-style: dashed; }
.status.todo { border-color: var(--muted); }
.status.started { border-color: var(--started); background: conic-gradient(var(--started) 0 50%, transparent 50% 100%); background-clip: content-box; padding: 2px; }
.status.done { border-color: var(--done); background: var(--done); position: relative; }
.status.done::after { content: ""; position: absolute; left: 3.5px; top: 1.5px; width: 3px; height: 6px; border: solid #fff; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
.status.canceled { border-color: var(--canceled); background: var(--canceled); }
.empty-state { padding: 48px 24px; color: var(--muted); }
.issue { display: grid; grid-template-columns: minmax(0, 1fr) 260px; flex: 1; }
.issue-body { padding: 32px 48px 64px; max-width: 860px; }
.issue-title { font-size: 24px; line-height: 32px; font-weight: 600; margin: 0 0 16px; }
.description { white-space: pre-wrap; line-height: 22px; font-size: 14px; }
.description.none { color: var(--faint); }
.section-title { font-size: 13px; font-weight: 500; margin: 40px 0 12px; }
.attachment { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; background: var(--panel); }
.attachment:hover { background: var(--hover); }
.attachment .subtitle { color: var(--muted); font-size: 12px; }
.activity { display: flex; gap: 10px; padding: 10px 0; }
.comment { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; background: var(--panel); }
.comment-meta { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
.comment-meta strong { color: var(--text); font-weight: 500; }
.comment-body { white-space: pre-wrap; }
.event { color: var(--muted); font-size: 12px; display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.properties { border-left: 1px solid var(--border); padding: 24px 16px; background: var(--bg); }
.property { display: grid; grid-template-columns: 80px 1fr; align-items: center; gap: 8px; min-height: 32px; }
.property .label { color: var(--muted); }
.property .value { display: flex; align-items: center; gap: 8px; }
.reactions { display: flex; gap: 6px; margin-top: 16px; }
.reaction { display: inline-flex; align-items: center; gap: 6px; height: 24px; border: 1px solid var(--border); border-radius: 12px; padding: 0 8px 0 6px; font-size: 12px; background: var(--panel); color: var(--muted); }
.reaction .emoji { font-size: 14px; }
.reaction .avatar { width: 16px; height: 16px; font-size: 8px; }
.consent { max-width: 440px; margin: 72px auto; padding: 0 20px; }
.consent-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 28px; }
.consent h1 { font-size: 18px; line-height: 26px; font-weight: 600; margin: 16px 0 6px; }
.consent .muted { color: var(--muted); }
.logos { display: flex; align-items: center; gap: 10px; }
.logo { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; color: #fff; }
.logo.app { background: #26b5ce; }
.logo.linear { background: var(--accent); }
.dots { color: var(--faint); letter-spacing: 2px; }
.choice { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; margin-top: 8px; cursor: pointer; }
.choice:hover { background: var(--hover); }
.scopes { margin: 16px 0 0; padding: 0; list-style: none; }
.scopes li { display: flex; gap: 8px; padding: 4px 0; }
.scopes li::before { content: "✓"; color: var(--accent); }
.buttons { display: flex; gap: 8px; margin-top: 24px; }
button { font: inherit; height: 32px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer; }
button:hover { background: var(--hover); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); flex: 1; }
button.primary:hover { background: var(--accent-hover); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { max-width: 440px; margin: 96px auto; text-align: center; }
.error h1 { font-size: 18px; font-weight: 600; }
.error p { color: var(--muted); }
`;

const SCOPE_TEXT: Record<string, string> = {
  read: "Read access to your workspace",
  write: "Write access to your workspace",
  "issues:create": "Create issues",
  "comments:create": "Create comments",
  admin: "Full access to your workspace, including admin settings",
  "app:assignable": "Be assigned to and delegated issues",
  "app:mentionable": "Be mentioned in issues and documents",
};

const EMOJI: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  heart: "❤️",
  eyes: "👀",
  tada: "🎉",
  rocket: "🚀",
};

const STATE_CLASS: Record<IssueState, string> = {
  Backlog: "backlog",
  Todo: "todo",
  "In Progress": "started",
  Done: "done",
  Canceled: "canceled",
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

export function errorPage(message: string, status = 400): Response {
  return page(
    "Linear",
    `<div class="error"><h1>Something went wrong</h1><p>${escapeHtml(message)}</p></div>`,
    status,
  );
}

function initials(text: string): string {
  return text
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function avatar(person: Person | null): string {
  if (!person) {
    return '<span class="avatar empty" title="Unassigned"></span>';
  }
  return `<span class="avatar${person.app ? " app" : ""}" title="${escapeHtml(person.name)}">${escapeHtml(initials(person.name))}</span>`;
}

function status(state: IssueState): string {
  return `<span class="status ${STATE_CLASS[state]}" title="${escapeHtml(state)}"></span>`;
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function layout(workspace: LinearWorkspace, selected: string, main: string): string {
  const { state } = workspace;
  const key = state.workspace.url_key;
  const teams = state.teams
    .map(
      (team) =>
        `<a class="nav-item${selected === team.key ? " selected" : ""}" href="/${escapeHtml(key)}/team/${escapeHtml(team.key)}/all"><span class="team-mark">${escapeHtml(team.key.slice(0, 2))}</span>${escapeHtml(team.name)}</a>`,
    )
    .join("");
  return `<div class="layout"><nav class="sidebar"><div class="workspace"><span class="workspace-mark">${escapeHtml(initials(state.workspace.name))}</span>${escapeHtml(state.workspace.name)}</div><a class="nav-item${selected === "" ? " selected" : ""}" href="/">All issues</a><div class="nav-heading">Your teams</div>${teams}</nav><main class="main">${main}</main></div>`;
}

export function issueListPage(workspace: LinearWorkspace, teamKey: string | null): Response {
  const team = teamKey ? workspace.team(teamKey) : undefined;
  const issues = workspace.data.issues
    .filter((issue) => !team || issue.team === team.key)
    .sort((a, b) => b.updated - a.updated);
  const groups = (Object.keys(STATE_CLASS) as IssueState[])
    .map((state) => {
      const rows = issues.filter((issue) => issue.state === state);
      if (rows.length === 0) {
        return "";
      }
      return `<div class="group">${status(state)}${escapeHtml(state)} <span class="count">${rows.length}</span></div>${rows.map((issue) => issueRow(workspace, issue)).join("")}`;
    })
    .join("");
  const heading = team ? team.name : "All issues";
  return page(
    `${heading} › ${workspace.state.workspace.name}`,
    layout(
      workspace,
      team?.key ?? "",
      `<div class="header"><strong>${escapeHtml(heading)}</strong></div>${groups || '<div class="empty-state">No issues yet. Create them with POST /_worlds/linear/issues.</div>'}`,
    ),
  );
}

function issueRow(workspace: LinearWorkspace, issue: Issue): string {
  return `<a class="row" href="${escapeHtml(new URL(workspace.issueUrl(issue)).pathname)}"><span class="identifier">${escapeHtml(issue.identifier)}</span>${status(issue.state)}<span class="title">${escapeHtml(issue.title)}</span><span class="date">${shortDate(issue.created)}</span>${avatar(workspace.person(issue.assignee))}</a>`;
}

export function issuePage(workspace: LinearWorkspace, issue: Issue): Response {
  const team = workspace.team(issue.team);
  const creator = workspace.person(issue.creator);
  const assignee = workspace.person(issue.assignee);
  const attachments = issue.attachments
    .map(
      (attachment) =>
        `<a class="attachment" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer"><span>🔗</span><span><div>${escapeHtml(attachment.title)}</div>${attachment.subtitle ? `<div class="subtitle">${escapeHtml(attachment.subtitle)}</div>` : ""}</span></a>`,
    )
    .join("");
  const comments = issue.comments
    .map((comment) => {
      const author = workspace.person(comment.user);
      return `<div class="activity">${avatar(author)}<div class="comment"><div class="comment-meta"><strong>${escapeHtml(author?.name ?? "Unknown")}</strong> · ${shortDate(comment.created)}</div><div class="comment-body">${escapeHtml(comment.body)}</div></div></div>`;
    })
    .join("");
  const reactions = issue.reactions.length
    ? `<div class="reactions">${reactionGroups(workspace, issue).join("")}</div>`
    : "";
  const key = workspace.state.workspace.url_key;
  return page(
    `${issue.identifier} ${issue.title}`,
    layout(
      workspace,
      issue.team,
      `<div class="header"><a href="/${escapeHtml(key)}/team/${escapeHtml(issue.team)}/all">${escapeHtml(team?.name ?? issue.team)}</a> › <strong>${escapeHtml(issue.identifier)}</strong></div>
<div class="issue"><div class="issue-body"><h1 class="issue-title">${escapeHtml(issue.title)}</h1>
<div class="description${issue.description ? "" : " none"}">${escapeHtml(issue.description ?? "No description")}</div>${reactions}
${attachments ? `<div class="section-title">Links</div>${attachments}` : ""}
<div class="section-title">Activity</div>
<div class="event">${avatar(creator)} ${escapeHtml(creator?.name ?? "Someone")} created the issue · ${shortDate(issue.created)}</div>
${comments}</div>
<aside class="properties"><div class="property"><span class="label">Status</span><span class="value">${status(issue.state)}${escapeHtml(issue.state)}</span></div>
<div class="property"><span class="label">Assignee</span><span class="value">${avatar(assignee)}${escapeHtml(assignee?.name ?? "Unassigned")}</span></div>
<div class="property"><span class="label">Team</span><span class="value">${escapeHtml(team?.name ?? issue.team)}</span></div></aside></div>`,
    ),
  );
}

function reactionGroups(workspace: LinearWorkspace, issue: Issue): string[] {
  const byEmoji = new Map<string, (Person | null)[]>();
  for (const reaction of issue.reactions) {
    byEmoji.set(reaction.emoji, [
      ...(byEmoji.get(reaction.emoji) ?? []),
      workspace.person(reaction.user),
    ]);
  }
  return [...byEmoji].map(([emoji, people]) => {
    const names = people.map((person) => person?.name ?? "Someone").join(", ");
    return `<span class="reaction" title="${escapeHtml(names)}"><span class="emoji">${escapeHtml(EMOJI[emoji] ?? emoji)}</span>${people.map(avatar).join("")}<span>${escapeHtml(names)}</span></span>`;
  });
}

export function consentPage(
  workspace: LinearWorkspace,
  app: LinearAppState,
  params: URLSearchParams,
  scopes: string[],
): Response {
  const hidden = [...params.entries()]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  const users = workspace.state.users
    .map(
      (user, index) =>
        `<label class="choice"><input type="radio" name="user_id" value="${escapeHtml(user.id)}"${index === 0 ? " checked" : ""}>${avatar(workspace.person(user.id))}<span>${escapeHtml(user.display_name)} <span class="muted">${escapeHtml(user.email)}</span></span></label>`,
    )
    .join("");
  const asApp = params.get("actor") === "app";
  return page(
    `Authorize ${app.name}`,
    `<div class="consent"><div class="consent-card"><div class="logos"><span class="logo app">${escapeHtml(initials(app.name))}</span><span class="dots">•••</span><span class="logo linear">${escapeHtml(initials(workspace.state.workspace.name))}</span></div>
<h1>${escapeHtml(app.name)} is requesting access to your ${escapeHtml(workspace.state.workspace.name)} workspace</h1>
<p class="muted">${asApp ? `${escapeHtml(app.name)} will be installed in the workspace as an app user.` : `${escapeHtml(app.name)} will act as you.`}</p>
<form method="post" action="/oauth/authorize">${hidden}
<div class="nav-heading" style="padding-left:0">Authorize as</div>${users || '<p class="muted">This world has no users.</p>'}
<ul class="scopes">${scopes.map((scope) => `<li>${escapeHtml(SCOPE_TEXT[scope] ?? scope)}</li>`).join("")}</ul>
<div class="buttons"><button type="submit" name="decision" value="deny">Cancel</button><button class="primary" type="submit" name="decision" value="accept"${workspace.state.users.length ? "" : " disabled"}>Authorize</button></div>
</form></div></div>`,
  );
}
