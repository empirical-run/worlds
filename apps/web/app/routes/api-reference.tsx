import { useEffect } from "react";

import { loadApiSpec } from "../api-spec.server";
import { FieldsTable, SchemaFields } from "../components/ApiSchema";
import { type RailHandle } from "../components/Rail";
import {
  contentSchema,
  endpointsByTag,
  typeAnchor,
  type Endpoint,
  type OpenApiDocument,
} from "../openapi";
import type { Route } from "./+types/api-reference";

export const headers: Route.HeadersFunction = () => ({
  "Cache-Control": "private, max-age=10",
  Vary: "Cookie",
});

export const meta = () => [{ title: "API reference · Worlds" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  return { spec: await loadApiSpec(context, request) };
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
    ];
  },
};

const LEGACY_TYPE_ANCHOR = "#object-";

export default function ApiReference({ loaderData: { spec } }: Route.ComponentProps) {
  const schemes = Object.values(spec.components?.securitySchemes ?? {});
  useEffect(() => {
    const { hash } = window.location;
    if (hash.startsWith(LEGACY_TYPE_ANCHOR)) {
      window.location.replace(`/docs/types#${typeAnchor(hash.slice(LEGACY_TYPE_ANCHOR.length))}`);
    }
  }, []);
  return (
    <article>
      <header className="section hero">
        <h1>API reference</h1>
        <p className="lede">
          Generated from{" "}
          <a href="/api/openapi.json">
            <code>/api/openapi.json</code>
          </a>
          . Base URL <code>{spec.servers?.[0]?.url}</code>; routes that act inside a world run on
          that world's hosts. Request and response objects are described under{" "}
          <a href="/docs/types">Types</a>.
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
  const requestSchema = contentSchema(operation.requestBody?.content);
  const success = Object.entries(operation.responses).find(([status]) => status.startsWith("2"));
  const successSchema = contentSchema(success?.[1].content);
  const server = operation.servers?.[0];
  return (
    <section className="section" id={anchor}>
      <h2>{operation.summary ?? path}</h2>
      <p className="endpoint">
        <span className={`method method-${method}`}>{method.toUpperCase()}</span>
        <code>{path}</code>
      </p>
      {server && (
        <p className="endpoint-host">
          Host <code>{server.url}</code>. {server.description}
        </p>
      )}
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
