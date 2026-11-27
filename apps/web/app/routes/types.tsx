import { SERVICES } from "@worlds/services";

import { loadApiSpec } from "../api-spec.server";
import { SchemaFields } from "../components/ApiSchema";
import { type RailHandle } from "../components/Rail";
import { typeAnchor, typeGroups, type OpenApiDocument } from "../openapi";
import type { Route } from "./+types/types";

export const headers: Route.HeadersFunction = () => ({
  "Cache-Control": "private, max-age=10",
  Vary: "Cookie",
});

export const meta = () => [{ title: "Types · Worlds" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const spec = await loadApiSpec(context, request);
  return {
    spec,
    groups: typeGroups(
      spec,
      SERVICES.map((service) => service.title),
    ).map(({ title, types }) => ({ title, names: types.map(([name]) => name) })),
  };
}

type TypesData = Awaited<ReturnType<typeof loader>>;

export const handle: RailHandle = {
  railIndex: (data) =>
    (data as TypesData).groups.map(({ title, names }) => ({
      heading: title,
      links: names.map((name) => ({ id: typeAnchor(name), label: name })),
    })),
};

export default function Types({ loaderData: { spec, groups } }: Route.ComponentProps) {
  return (
    <article>
      <header className="section hero">
        <h1>Types</h1>
        <p className="lede">
          Every object the API takes or returns. The <code>makeworlds</code> package exports each as
          a TypeScript type of the same name.
        </p>
      </header>
      {groups.map(({ title, names }) => (
        <section className="section" key={title} id={`types-${title.toLowerCase()}`}>
          <h2>{title}</h2>
          {names.map((name) => (
            <TypeSection key={name} name={name} spec={spec} />
          ))}
        </section>
      ))}
    </article>
  );
}

function TypeSection({ name, spec }: { name: string; spec: OpenApiDocument }) {
  const schema = spec.components?.schemas?.[name];
  if (!schema) {
    throw new Error(`no schema ${name}`);
  }
  return (
    <div className="type">
      <h3 id={typeAnchor(name)}>{name}</h3>
      {schema.description && <p>{schema.description}</p>}
      <SchemaFields schema={schema} spec={spec} />
    </div>
  );
}
