import type { ApiKey, User } from "./schema";

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => escapes[char] ?? char);
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function railUser(user: User): string {
  const name = user.name ?? user.email;
  const avatar = user.picture
    ? `<img class="avatar" src="${escape(user.picture)}" alt="" width="28" height="28" referrerpolicy="no-referrer">`
    : `<span class="avatar" aria-hidden="true">${escape(name.charAt(0).toUpperCase())}</span>`;
  return `<a class="rail-user" href="/account">${avatar}<span class="rail-user-text"><span class="rail-user-name">${escape(name)}</span><span class="rail-user-email">${escape(user.email)}</span></span></a>`;
}

function layout(title: string, body: string, user?: User): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/styles.css">
    <title>${escape(title)} · Worlds</title>
  </head>
  <body>
    <div class="page">
      <aside class="rail">
        <a class="brand" href="/"><img src="/favicon.svg" alt="" width="18" height="18">Worlds</a>
        <nav aria-label="Main">
          <a class="rail-link" href="/">Home</a>
          <a class="rail-link" href="/docs/">Docs</a>
          <a class="rail-link" href="/account" aria-current="page">Account</a>
        </nav>
        ${user ? railUser(user) : ""}
        <div class="rail-foot"><span>Built by <a href="https://empirical.run">Empirical</a></span><a class="rail-foot-link" href="/privacy">Privacy policy</a></div>
      </aside>
      <main class="content">
        <article>${body}</article>
      </main>
    </div>
  </body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function signInPage(error?: string): Response {
  return layout(
    "Sign in",
    `<header class="section hero">
      <h1>Sign in</h1>
      <p class="lede">Sign in to create API keys for Worlds.</p>
      ${error ? `<p class="notice error" role="alert">${escape(error)}</p>` : ""}
      <div class="actions"><a class="button primary" href="/auth/google?next=/account">Sign in with Google</a></div>
      <p class="fine">By signing in you agree to the <a href="/privacy">privacy policy</a>.</p>
    </header>`,
  );
}

export function accountPage(user: User, keys: ApiKey[], newKey?: string): Response {
  return layout(
    "Account",
    `<header class="section hero">
      <h1>Account</h1>
      <p class="lede">Signed in as <strong>${escape(user.email)}</strong>.</p>
      <form method="post" action="/auth/sign-out"><button class="button" type="submit">Sign out</button></form>
    </header>
    <section class="section" id="keys">
      <h2>API keys</h2>
      <p>Send a key as <code>Authorization: Bearer &lt;key&gt;</code>. Keys are shown once and stored only as a hash.</p>
      ${newKey ? newKeyNotice(newKey) : ""}
      <form class="key-form" method="post" action="/account/keys">
        <label for="key-name">Name</label>
        <input id="key-name" name="name" required maxlength="80" placeholder="CI" autocomplete="off">
        <button class="button primary" type="submit">Create key</button>
      </form>
      ${keys.length ? keyTable(keys) : `<p class="empty">No API keys yet.</p>`}
    </section>`,
    user,
  );
}

function newKeyNotice(key: string): string {
  return `<div class="notice" role="status">
    <p><strong>Copy your new key now.</strong> You won't see it again.</p>
    <pre><code>${escape(key)}</code></pre>
  </div>`;
}

function keyTable(keys: ApiKey[]): string {
  const rows = keys
    .map(
      (key) => `<tr>
        <td>${escape(key.name)}</td>
        <td><code>${escape(key.prefix)}…</code></td>
        <td>${dateFormat.format(key.createdAt)}</td>
        <td>${key.lastUsedAt ? dateFormat.format(key.lastUsedAt) : "Never"}</td>
        <td><form method="post" action="/account/keys/${escape(key.id)}/revoke"><button class="link-button" type="submit">Revoke</button></form></td>
      </tr>`,
    )
    .join("");
  return `<table class="keys">
    <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
