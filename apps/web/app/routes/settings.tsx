import { API_KEY_NAME_MAX, TEAM_NAME_MAX } from "@worlds/db";
import type { ApiKey } from "makeworlds";

import { requireAccount } from "../account.server";
import { actionData, api, formText, orThrow } from "../api.server";
import { CopyButton } from "../components/CopyButton";
import { DataTable } from "../components/DataTable";
import { ActionError, dateFormat, InlineTextForm, RowAction } from "../components/forms";
import { Notice } from "../components/Notice";
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
          <InlineTextForm
            key={team.name}
            intent="rename-team"
            label="Name"
            input={{
              id: "team-name",
              name: "name",
              required: true,
              maxLength: TEAM_NAME_MAX,
              defaultValue: team.name,
            }}
            submitLabel="Save"
            result={actionData}
            successMessage="Saved."
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
          <Notice>
            <p>
              <strong>Copy your new key now.</strong> You won't see it again.
            </p>
            <div className="secret">
              <pre>
                <code>{actionData.secret}</code>
              </pre>
              <CopyButton text={actionData.secret} />
            </div>
          </Notice>
        )}
        <InlineTextForm
          key={actionData?.secret}
          intent="create-key"
          label="Name"
          input={{
            id: "key-name",
            name: "name",
            required: true,
            maxLength: API_KEY_NAME_MAX,
            placeholder: "CI",
          }}
          submitLabel="Create key"
          variant="primary"
          result={actionData}
        />
        <ActionError result={actionData} intent="revoke-key" />
        {keys.length ? <KeyTable keys={keys} /> : <p className="empty">No API keys yet.</p>}
      </section>
    </article>
  );
}

function KeyTable({ keys }: { keys: ApiKey[] }) {
  return (
    <DataTable columns={["Name", "Key", "Created", "Last used"]}>
      {keys.map((key) => (
        <tr key={key.id}>
          <td>{key.name}</td>
          <td>
            <code>{key.prefix}…</code>
          </td>
          <td>{dateFormat.format(new Date(key.created_at))}</td>
          <td>{key.last_used_at ? dateFormat.format(new Date(key.last_used_at)) : "Never"}</td>
          <td>
            <RowAction intent="revoke-key" name="keyId" value={key.id}>
              Revoke
            </RowAction>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
