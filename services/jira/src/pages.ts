import { adfToText, jiraDate, type Issue } from "./model";
import type { JiraAppState, JiraState } from "./spec";

const STYLE = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; background: Canvas; color: CanvasText; }
main { max-width: 760px; margin: 48px auto; padding: 0 20px; }
h1 { font-size: 22px; margin: 0 0 8px; }
p, li { line-height: 1.5; }
.muted { opacity: 0.7; font-size: 14px; }
.card { border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 8px; padding: 16px 20px; margin: 16px 0; }
.label { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 4px; background: color-mix(in srgb, CanvasText 10%, transparent); margin-right: 4px; }
button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; cursor: pointer; }
button.primary { background: #0c66e4; border-color: #0c66e4; color: white; }
label.user { display: flex; gap: 8px; align-items: center; padding: 6px 0; }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; padding: 8px 6px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); font-size: 14px; }
pre { white-space: pre-wrap; font: inherit; margin: 0; }
a { color: #0c66e4; }
`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function errorPage(message: string, status = 400): Response {
  return page("Something went wrong", `<h1>Something went wrong</h1><p>${escapeHtml(message)}</p>`, status);
}

export function consentPage(state: JiraState, app: JiraAppState, params: URLSearchParams, scopes: string[]): Response {
  const hidden = [...params.entries()].map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join("");
  const users = state.users
    .map(
      (user, index) =>
        `<label class="user"><input type="radio" name="account_id" value="${escapeHtml(user.account_id)}"${index === 0 ? " checked" : ""}> ${escapeHtml(user.display_name)} <span class="muted">${escapeHtml(user.email)}</span></label>`,
    )
    .join("");
  return page(
    `${app.name} is requesting access`,
    `<h1>${escapeHtml(app.name)} is requesting access to your Atlassian account</h1>
<p class="muted">Site: ${escapeHtml(state.site.name)} (${escapeHtml(state.site.url)})</p>
<form method="post" action="/authorize">${hidden}
<div class="card"><strong>Continue as</strong>${users || '<p class="muted">This world has no users.</p>'}</div>
<div class="card"><strong>${escapeHtml(app.name)} will be able to</strong><ul>${scopes.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("")}</ul></div>
<button class="primary" type="submit" name="decision" value="accept"${state.users.length ? "" : " disabled"}>Accept</button>
<button type="submit" name="decision" value="deny">Cancel</button>
</form>`,
  );
}

export function issueListPage(state: JiraState, issues: Issue[]): Response {
  const rows = issues
    .map(
      (issue) =>
        `<tr><td><a href="/browse/${escapeHtml(issue.key)}">${escapeHtml(issue.key)}</a></td><td>${escapeHtml(issue.summary)}</td><td>${escapeHtml(issue.status)}</td><td>${issue.labels.map((label) => `<span class="label">${escapeHtml(label)}</span>`).join("")}</td></tr>`,
    )
    .join("");
  return page(
    state.site.name,
    `<h1>${escapeHtml(state.site.name)}</h1><p class="muted">Jira site ${escapeHtml(state.site.url)} · cloud id ${escapeHtml(state.site.cloud_id)}</p>
${issues.length ? `<table><thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Labels</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No issues yet. Create them with POST /_worlds/jira/issues.</p>'}`,
  );
}

export function issuePage(state: JiraState, issue: Issue): Response {
  const name = (accountId: string | null) => state.users.find((user) => user.account_id === accountId)?.display_name ?? "Unassigned";
  const comments = issue.comments
    .map((comment) => `<div class="card"><p class="muted">${escapeHtml(name(comment.author))} · ${jiraDate(comment.created)}</p><pre>${escapeHtml(adfToText(comment.body))}</pre></div>`)
    .join("");
  return page(
    `${issue.key} ${issue.summary}`,
    `<p class="muted"><a href="/">${escapeHtml(state.site.name)}</a> / ${escapeHtml(issue.key)}</p>
<h1>${escapeHtml(issue.summary)}</h1>
<p>${issue.labels.map((label) => `<span class="label">${escapeHtml(label)}</span>`).join("")}</p>
<p class="muted">${escapeHtml(issue.status)} · reporter ${escapeHtml(name(issue.reporter))} · assignee ${escapeHtml(name(issue.assignee))}</p>
<div class="card"><pre>${escapeHtml(issue.description ? adfToText(issue.description) : "No description")}</pre></div>
<h2>Comments</h2>${comments || '<p class="muted">No comments.</p>'}`,
  );
}
