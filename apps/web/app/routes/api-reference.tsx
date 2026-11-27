import { workerContext } from "../../worker/context";
import { type RailHandle } from "../components/Rail";
import {
  endpointsByTag,
  fieldDescription,
  fieldsOf,
  linkedSchema,
  objectAnchor,
  typeLabel,
  type Endpoint,
  type Field,
  type OpenApiDocument,
  type Schema,
} from "../openapi";
import type { Route } from "./+types/api-reference";

export const headers: Route.HeadersFunction = () => ({
  "Cache-Control": "private, max-age=300",
  Vary: "Cookie",
});

export const meta = () => [{ title: "API reference · Worlds" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(workerContext);
  const response = await env.API.fetch(new Request(new URL("/api/openapi.json", request.url)));
  if (!response.ok) throw new Response("The API description is unavailable.", { status: 502 });
  return { spec: (await response.json()) as OpenApiDocument };
}

export const handle: RailHandle = {
  railIndex: (data) => {
    const { spec } = data as { spec: OpenApiDocument };
    return [
      { heading: "Overview", links: [{ id: "authentication", label: "Authentication" }] },
      ...endpointsByTag(spec).map(([tag, endpoints]) => ({
        heading: tag,
        links: endpoints.map((endpoint) => ({
          id: endpoint.anchor,
          label: endpoint.operation.summary ?? endpoint.path,
        })),
      })),
      {
        heading: "Objects",
        links: Object.keys(spec.components?.schemas ?? {}).map((name) => ({
          id: objectAnchor(name),
          label: name,
        })),
      },
    ];
  },
};

export default function ApiReference({ loaderData: { spec } }: Route.ComponentProps) {
  const schemes = Object.values(spec.components?.securitySchemes ?? {});
  return (
    <article>
      <header className="section hero">
        <h1>API reference</h1>
        <p className="lede">
          Generated from{" "}
          <a href="/api/openapi.json">
            <code>/api/openapi.json</code>
          </a>
          . Base URL <code>{spec.servers?.[0]?.url}</code>.
        </p>
      </header>

      <section className="section" id="authentication">
        <h2>Authentication</h2>
        <ul>
          {schemes.map((scheme) => (
            <li key={scheme.description}>{scheme.description}</li>
          ))}
        </ul>
        <p>
          Errors share one shape: <code>{'{"error": {"code": "…", "message": "…"}}'}</code>.
        </p>
      </section>

      {endpointsByTag(spec).flatMap(([, endpoints]) =>
        endpoints.map((endpoint) => (
          <EndpointSection key={endpoint.anchor} endpoint={endpoint} spec={spec} />
        )),
      )}

      <section className="section" id="objects">
        <h2>Objects</h2>
        {Object.entries(spec.components?.schemas ?? {}).map(([name, schema]) => (
          <div key={name}>
            <h3 id={objectAnchor(name)}>{name}</h3>
            <SchemaFields schema={schema} spec={spec} />
          </div>
        ))}
      </section>
    </article>
  );
}

function EndpointSection({
  endpoint: { method, path, operation, anchor },
  spec,
}: {
  endpoint: Endpoint;
  spec: OpenApiDocument;
}) {
  const params = (operation.parameters ?? []).filter(
    (param) => param.in === "path" || param.in === "query",
  );
  const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
  const success = Object.entries(operation.responses).find(([status]) => status.startsWith("2"));
  const successSchema = success?.[1].content?.["application/json"]?.schema;
  return (
    <section className="section" id={anchor}>
      <h2>{operation.summary ?? path}</h2>
      <p className="endpoint">
        <span className={`method method-${method}`}>{method.toUpperCase()}</span>
        <code>{path}</code>
      </p>
      {operation.description && <p>{operation.description}</p>}
      {params.length > 0 && (
        <>
          <h3>Parameters</h3>
          <FieldsTable
            fields={params.map((param) => ({
              name: param.name,
              schema: param.schema ?? {},
              required: param.required ?? false,
              note: param.description,
            }))}
            spec={spec}
          />
        </>
      )}
      {requestSchema && (
        <>
          <h3>Request body</h3>
          <SchemaFields schema={requestSchema} spec={spec} />
        </>
      )}
      {success && (
        <>
          <h3>
            Response <code>{success[0]}</code>
          </h3>
          {successSchema ? (
            <SchemaFields schema={successSchema} spec={spec} />
          ) : (
            <p>{success[1].description}</p>
          )}
        </>
      )}
      <h3>Status codes</h3>
      <ul className="statuses">
        {Object.entries(operation.responses).map(([status, response]) => (
          <li key={status}>
            <code>{status}</code> {response.description}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SchemaFields({ schema, spec }: { schema: Schema; spec: OpenApiDocument }) {
  const fields = fieldsOf(schema, spec);
  return fields ? (
    <FieldsTable fields={fields} spec={spec} />
  ) : (
    <p>
      <TypeName schema={schema} />
    </p>
  );
}

function FieldsTable({ fields, spec }: { fields: Field[]; spec: OpenApiDocument }) {
  return (
    <div className="table-scroll">
      <table className="fields">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name}>
              <td>
                <code>{field.name}</code>
                {!field.required && <span className="optional"> optional</span>}
              </td>
              <td>
                <TypeName schema={field.schema} />
              </td>
              <td>{fieldDescription(field, spec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TypeName({ schema }: { schema: Schema }) {
  const label = <code>{typeLabel(schema)}</code>;
  const linked = linkedSchema(schema);
  return linked ? <a href={`#${objectAnchor(linked)}`}>{label}</a> : label;
}
