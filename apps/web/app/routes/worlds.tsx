import { WORLD_NAME_MAX } from "@worlds/db";
import type { World } from "makeworlds";
import { Form, useNavigation } from "react-router";
import { requireAccount } from "../account.server";
import { actionData, api, orThrow } from "../api.server";
import { ActionError, dateFormat, useSubmitting } from "../components/forms";
import type { Route } from "./+types/worlds";

export const meta = () => [{ title: "Worlds · Worlds" }, { name: "robots", content: "noindex" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const account = requireAccount(context, request);
  const { worlds } = orThrow(await api(context, request).GET("/api/worlds"));
  return { worlds: worlds.filter((world) => world.team_id === account.team.id) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const account = requireAccount(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "create-world") {
    const name = String(form.get("name") ?? "").trim();
    const result = await api(context, request).POST("/api/worlds", { body: { team_id: account.team.id, ...(name ? { name } : {}) } });
    return actionData(intent, result, (world) => ({ createdWorld: world.id }));
  }
  if (intent === "archive-world") {
    const worldId = String(form.get("worldId"));
    return actionData(intent, await api(context, request).POST("/api/worlds/{worldId}/archive", { params: { path: { worldId } } }));
  }
  throw new Response("Unknown action.", { status: 400 });
}

export default function Worlds({ loaderData: { worlds }, actionData }: Route.ComponentProps) {
  return (
    <article>
      <header className="section hero">
        <h1>Worlds</h1>
        <p className="lede">Each world is a separate Slack workspace your app can talk to. It keeps its state until you archive it.</p>
      </header>
      <section className="section">
        <CreateWorldForm key={actionData?.createdWorld} error={actionData?.intent === "create-world" ? actionData.error : undefined} />
        <ActionError result={actionData} intent="archive-world" />
        {worlds.length ? <WorldTable worlds={worlds} /> : <p className="empty">No worlds yet.</p>}
      </section>
    </article>
  );
}

function CreateWorldForm({ error }: { error?: string }) {
  const submitting = useSubmitting("create-world");
  return (
    <Form className="inline-form" method="post">
      <input type="hidden" name="intent" value="create-world" />
      <label htmlFor="world-name">Name</label>
      <input id="world-name" name="name" maxLength={WORLD_NAME_MAX} placeholder="Untitled world" autoComplete="off" />
      <button className="button primary" type="submit" disabled={submitting}>
        Create world
      </button>
      {!submitting && error && (
        <p className="form-status error" role="alert">
          {error}
        </p>
      )}
    </Form>
  );
}

function WorldTable({ worlds }: { worlds: World[] }) {
  const navigation = useNavigation();
  const archiving = navigation.formData?.get("intent") === "archive-world" ? navigation.formData.get("worldId") : null;
  return (
    <table className="keys">
      <thead>
        <tr>
          <th>Name</th>
          <th>Id</th>
          <th>Created</th>
          <th>
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {worlds.map((world) => (
          <tr key={world.id}>
            <td>
              <a href={world.slack.ui_url}>{world.name}</a>
            </td>
            <td>
              <code>{world.id}</code>
            </td>
            <td>{dateFormat.format(new Date(world.created_at))}</td>
            <td>
              <Form method="post">
                <input type="hidden" name="intent" value="archive-world" />
                <input type="hidden" name="worldId" value={world.id} />
                <button className="link-button" type="submit" disabled={archiving === world.id}>
                  Archive
                </button>
              </Form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
