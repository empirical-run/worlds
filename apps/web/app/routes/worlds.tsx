import { WORLD_NAME_MAX } from "@worlds/db";
import type { World } from "makeworlds";

import { requireAccount } from "../account.server";
import { actionData, api, formText, orThrow } from "../api.server";
import { DataTable } from "../components/DataTable";
import { ActionError, dateFormat, InlineTextForm, RowAction } from "../components/forms";
import type { Route } from "./+types/worlds";

export const meta = () => [{ title: "Worlds · Worlds" }, { name: "robots", content: "noindex" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const account = requireAccount(context, request);
  const { worlds } = orThrow(await api(context, request).GET("/api/worlds"));
  return { worlds: worlds.filter((world) => world.team_id === account.team.id) };
}

export async function action({ request, context }: Route.ActionArgs) {
  requireAccount(context, request);
  const form = await request.formData();
  const intent = formText(form, "intent");
  if (intent === "create-world") {
    const name = formText(form, "name").trim();
    const result = await api(context, request).POST("/api/worlds", { body: name ? { name } : {} });
    return actionData(intent, result, (world) => ({ createdWorld: world.id }));
  }
  if (intent === "archive-world") {
    const worldId = formText(form, "worldId");
    return actionData(
      intent,
      await api(context, request).POST("/api/worlds/{worldId}/archive", {
        params: { path: { worldId } },
      }),
    );
  }
  throw new Response("Unknown action.", { status: 400 });
}

export default function Worlds({ loaderData: { worlds }, actionData }: Route.ComponentProps) {
  return (
    <article>
      <header className="section hero">
        <h1>Worlds</h1>
        <p className="lede">
          Each world is a private copy of the services your app talks to. It keeps its state until
          you archive it.
        </p>
      </header>
      <section className="section">
        <InlineTextForm
          key={actionData?.createdWorld}
          intent="create-world"
          label="Name"
          input={{
            id: "world-name",
            name: "name",
            maxLength: WORLD_NAME_MAX,
            placeholder: "Untitled world",
          }}
          submitLabel="Create world"
          variant="primary"
          result={actionData}
        />
        <ActionError result={actionData} intent="archive-world" />
        {worlds.length ? <WorldTable worlds={worlds} /> : <p className="empty">No worlds yet.</p>}
      </section>
    </article>
  );
}

function WorldTable({ worlds }: { worlds: World[] }) {
  return (
    <DataTable columns={["Name", "Id", "Created"]}>
      {worlds.map((world) => (
        <tr key={world.id}>
          <td>
            <a href={world.ui_url}>{world.name}</a>
          </td>
          <td>
            <code>{world.id}</code>
          </td>
          <td>{dateFormat.format(new Date(world.created_at))}</td>
          <td>
            <RowAction intent="archive-world" name="worldId" value={world.id}>
              Archive
            </RowAction>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
