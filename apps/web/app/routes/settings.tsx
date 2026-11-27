import { API_KEY_NAME_MAX, TEAM_NAME_MAX } from "@worlds/db";
import type { ApiKey } from "makeworlds";
import { Form, useNavigation } from "react-router";

import { requireAccount } from "../account.server";
import { actionData, api, formText, orThrow } from "../api.server";
import { ActionError, type ActionResult, dateFormat, useSubmitting } from "../components/forms";
import type { Route } from "./+types/settings";

export const meta = () => [{ title: "Settings · Worlds" }, { name: "robots", content: "noindex" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const account = requireAccount(context, request);
  const teamId = account.team.id;
  const { api_keys: keys } = orThrow(
    await api(context, request).GET("/api/teams/{teamId}/api-keys", {
      params: { path: { teamId } },
    }),
  );
  return { team: { id: account.team.id, name: account.team.name }, role: account.role, keys };
}

export async function action({ request, context }: Route.ActionArgs) {
  const account = requireAccount(context, request);
  const form = await request.formData();
  const intent = formText(form, "intent");
  const client = api(context, request);
  const teamId = account.team.id;
  if (intent === "rename-team") {
    const result = await client.PATCH("/api/teams/{teamId}", {
      params: { path: { teamId } },
      body: { name: formText(form, "name") },
    });
    return actionData(intent, result, () => ({ saved: true }));
  }
  if (intent === "create-key") {
    const result = await client.POST("/api/teams/{teamId}/api-keys", {
      params: { path: { teamId } },
      body: { name: formText(form, "name") },
    });
    return actionData(intent, result, (key) => ({ secret: key.secret }));
  }
  if (intent === "revoke-key") {
    const keyId = formText(form, "keyId");
    return actionData(
      intent,
      await client.DELETE("/api/teams/{teamId}/api-keys/{keyId}", {
        params: { path: { teamId, keyId } },
      }),
    );
  }
  throw new Response("Unknown action.", { status: 400 });
}

export default function Settings({
  loaderData: { team, role, keys },
  actionData,
}: Route.ComponentProps) {
  return (
    <article>
      <header className="section hero">
        <h1>Settings</h1>
        <p className="lede">
          Settings for the team <strong>{team.name}</strong>.
        </p>
      </header>

      <section className="section" id="team">
        <h2>Team name</h2>
        {role === "owner" ? (
          <TeamNameForm
            name={team.name}
            result={actionData?.intent === "rename-team" ? actionData : undefined}
          />
        ) : (
          <p>
            <strong>{team.name}</strong>. Only owners can rename the team.
          </p>
        )}
      </section>

      <section className="section" id="keys">
        <h2>API keys</h2>
        <p>
          Keys belong to your team. Send a key as <code>Authorization: Bearer &lt;key&gt;</code>.
          Keys are shown once and stored only as a hash.
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
        <CreateKeyForm
          key={actionData?.secret}
          error={actionData?.intent === "create-key" ? actionData.error : undefined}
        />
        <ActionError result={actionData} intent="revoke-key" />
        {keys.length ? <KeyTable keys={keys} /> : <p className="empty">No API keys yet.</p>}
      </section>
    </article>
  );
}

function TeamNameForm({ name, result }: { name: string; result?: ActionResult }) {
  const submitting = useSubmitting("rename-team");
  return (
    <Form className="inline-form" method="post" key={name}>
      <input type="hidden" name="intent" value="rename-team" />
      <label htmlFor="team-name">Name</label>
      <input
        id="team-name"
        name="name"
        required
        maxLength={TEAM_NAME_MAX}
        defaultValue={name}
        autoComplete="off"
      />
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
      <input
        id="key-name"
        name="name"
        required
        maxLength={API_KEY_NAME_MAX}
        placeholder="CI"
        autoComplete="off"
      />
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

function KeyTable({ keys }: { keys: ApiKey[] }) {
  const navigation = useNavigation();
  const revoking =
    navigation.formData?.get("intent") === "revoke-key" ? navigation.formData.get("keyId") : null;
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
