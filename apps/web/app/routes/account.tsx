import type { ApiKeyCreatedJson, ApiKeyJson, ApiKeyListJson, TeamJson } from "@worlds/api/schemas";
import { API_KEY_NAME_MAX, providersFor, TEAM_NAME_MAX, type Provider } from "@worlds/db";
import { data, Form, useNavigation } from "react-router";
import { workerContext } from "../../worker/context";
import { callApi, requireApi } from "../api.server";
import type { Route } from "./+types/account";

export const meta = () => [{ title: "Account · Worlds" }, { name: "robots", content: "noindex" }];

const PROVIDER_NAMES: Record<Provider, string> = { google: "Google", github: "GitHub" };

const SIGN_IN_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "Your sign-in link expired. Try again.",
};

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export async function loader({ request, context }: Route.LoaderArgs) {
  const { account, db } = context.get(workerContext);
  if (!account) {
    const reason = new URL(request.url).searchParams.get("sign_in");
    return { signedIn: false as const, signInError: reason ? (SIGN_IN_ERRORS[reason] ?? null) : null };
  }
  const { api_keys: keys } = await requireApi<ApiKeyListJson>(context, request, `/api/teams/${account.team.id}/api-keys`);
  return {
    signedIn: true as const,
    email: account.user.email,
    providers: await providersFor(db, account.user.id),
    team: { id: account.team.id, name: account.team.name },
    role: account.role,
    keys,
  };
}

type ActionResult = { intent: string; error?: string; secret?: string; saved?: boolean };

export async function action({ request, context }: Route.ActionArgs) {
  const { account } = context.get(workerContext);
  if (!account) throw new Response("Sign in first.", { status: 401 });
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const teamPath = `/api/teams/${account.team.id}`;

  if (intent === "rename-team") {
    const result = await callApi<TeamJson>(context, request, teamPath, { method: "PATCH", body: { name: String(form.get("name") ?? "") } });
    return data<ActionResult>(result.ok ? { intent, saved: true } : { intent, error: result.error.message }, result.ok ? 200 : result.status);
  }
  if (intent === "create-key") {
    const result = await callApi<ApiKeyCreatedJson>(context, request, `${teamPath}/api-keys`, {
      method: "POST",
      body: { name: String(form.get("name") ?? "") },
    });
    return data<ActionResult>(result.ok ? { intent, secret: result.data.secret } : { intent, error: result.error.message }, result.ok ? 200 : result.status);
  }
  if (intent === "revoke-key") {
    const result = await callApi<void>(context, request, `${teamPath}/api-keys/${String(form.get("keyId"))}`, { method: "DELETE" });
    return data<ActionResult>(result.ok ? { intent } : { intent, error: result.error.message }, result.ok ? 200 : result.status);
  }
  throw new Response("Unknown action.", { status: 400 });
}

export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  if (!loaderData.signedIn) return <SignIn error={loaderData.signInError} />;
  const { email, providers, team, role, keys } = loaderData;
  return (
    <article>
      <header className="section hero">
        <h1>Account</h1>
        <p className="lede">
          Signed in as <strong>{email}</strong>.
        </p>
        <form method="post" action="/auth/sign-out">
          <button className="button" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <section className="section" id="sign-in-methods">
        <h2>Sign-in methods</h2>
        <p>
          {providers.length
            ? `${providers.map((provider) => PROVIDER_NAMES[provider]).join(" and ")}. Signing in with another provider that has the same verified email opens this account.`
            : "No sign-in method is linked to this account."}
        </p>
      </section>

      <section className="section" id="team">
        <h2>Team</h2>
        {role === "owner" ? (
          <TeamNameForm name={team.name} result={actionData?.intent === "rename-team" ? actionData : undefined} />
        ) : (
          <p>
            <strong>{team.name}</strong>. Only owners can rename the team.
          </p>
        )}
      </section>

      <section className="section" id="keys">
        <h2>API keys</h2>
        <p>
          Keys belong to your team. Send a key as <code>Authorization: Bearer &lt;key&gt;</code>. Keys are shown once and stored only as a
          hash.
        </p>
        {actionData?.secret && (
          <div className="notice" role="status">
            <p>
              <strong>Copy your new key now.</strong> You won't see it again.
            </p>
            <pre>
              <code>{actionData.secret}</code>
            </pre>
          </div>
        )}
        <CreateKeyForm key={actionData?.secret} error={actionData?.intent === "create-key" ? actionData.error : undefined} />
        {actionData?.intent === "revoke-key" && actionData.error && (
          <p className="form-status error" role="alert">
            {actionData.error}
          </p>
        )}
        {keys.length ? <KeyTable keys={keys} /> : <p className="empty">No API keys yet.</p>}
      </section>
    </article>
  );
}

function SignIn({ error }: { error: string | null }) {
  return (
    <header className="section hero">
      <h1>Sign in</h1>
      <p className="lede">Sign in to create API keys for Worlds.</p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <a className="button primary" href="/auth/google?next=/account">
          Sign in with Google
        </a>
        <a className="button" href="/auth/github?next=/account">
          Sign in with GitHub
        </a>
      </div>
      <p className="fine">
        By signing in you agree to the <a href="/privacy">privacy policy</a>.
      </p>
    </header>
  );
}

function useSubmitting(intent: string): boolean {
  const navigation = useNavigation();
  return navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
}

function TeamNameForm({ name, result }: { name: string; result?: ActionResult }) {
  const submitting = useSubmitting("rename-team");
  return (
    <Form className="inline-form" method="post" key={name}>
      <input type="hidden" name="intent" value="rename-team" />
      <label htmlFor="team-name">Name</label>
      <input id="team-name" name="name" required maxLength={TEAM_NAME_MAX} defaultValue={name} autoComplete="off" />
      <button className="button" type="submit" disabled={submitting}>
        Save
      </button>
      {!submitting && result && (
        <p className={`form-status${result.error ? " error" : ""}`} role="status">
          {result.error ?? "Saved."}
        </p>
      )}
    </Form>
  );
}

function CreateKeyForm({ error }: { error?: string }) {
  const submitting = useSubmitting("create-key");
  return (
    <Form className="inline-form" method="post">
      <input type="hidden" name="intent" value="create-key" />
      <label htmlFor="key-name">Name</label>
      <input id="key-name" name="name" required maxLength={API_KEY_NAME_MAX} placeholder="CI" autoComplete="off" />
      <button className="button primary" type="submit" disabled={submitting}>
        Create key
      </button>
      {!submitting && error && (
        <p className="form-status error" role="alert">
          {error}
        </p>
      )}
    </Form>
  );
}

function KeyTable({ keys }: { keys: ApiKeyJson[] }) {
  const navigation = useNavigation();
  const revoking = navigation.formData?.get("intent") === "revoke-key" ? navigation.formData.get("keyId") : null;
  return (
    <table className="keys">
      <thead>
        <tr>
          <th>Name</th>
          <th>Key</th>
          <th>Created</th>
          <th>Last used</th>
          <th>
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key.id}>
            <td>{key.name}</td>
            <td>
              <code>{key.prefix}…</code>
            </td>
            <td>{dateFormat.format(new Date(key.created_at))}</td>
            <td>{key.last_used_at ? dateFormat.format(new Date(key.last_used_at)) : "Never"}</td>
            <td>
              <Form method="post">
                <input type="hidden" name="intent" value="revoke-key" />
                <input type="hidden" name="keyId" value={key.id} />
                <button className="link-button" type="submit" disabled={revoking === key.id}>
                  Revoke
                </button>
              </Form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
