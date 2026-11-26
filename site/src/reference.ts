import { escape, layout, type RailAccount } from "./pages";

type Schema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: (string | null)[];
  description?: string;
  example?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  allOf?: Schema[];
  minLength?: number;
  maxLength?: number;
};

type Parameter = { name: string; in: string; required?: boolean; schema?: Schema; description?: string };

type Operation = {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema?: Schema }> }>;
};

export type OpenApiDocument = {
  info: { title: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, Operation>>;
  components?: {
    schemas?: Record<string, Schema>;
    securitySchemes?: Record<string, { description?: string }>;
  };
};

const METHODS = ["get", "post", "put", "patch", "delete"];

type Entry = { method: string; path: string; operation: Operation; anchor: string };

export function apiReferencePage(spec: OpenApiDocument, account: RailAccount | undefined): Response {
  const entries = Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method]).map((method) => {
      const operation = item[method] as Operation;
      return { method, path, operation, anchor: anchorFor(operation.summary ?? `${method} ${path}`) };
    }),
  );
  const groups = groupByTag(entries);
  const railIndex = `<div class="rail-index">
    <p class="rail-heading">API reference</p>
    <a href="#authentication">Authentication</a>
    ${[...groups].map(([tag, list]) => `<p class="rail-heading rail-subheading">${escape(tag)}</p>${list.map((entry) => `<a href="#${entry.anchor}">${escape(entry.operation.summary ?? entry.path)}</a>`).join("")}`).join("")}
    <a href="#objects">Objects</a>
  </div>`;
  const base = spec.servers?.[0]?.url ?? "";
  const schemes = Object.values(spec.components?.securitySchemes ?? {});
  const body = `<header class="section hero">
      <h1>API reference</h1>
      <p class="lede">Generated from <a href="/api/openapi.json"><code>/api/openapi.json</code></a>. Base URL <code>${escape(base)}</code>.</p>
    </header>
    <section class="section" id="authentication">
      <h2>Authentication</h2>
      <ul>${schemes.map((scheme) => `<li>${escape(scheme.description ?? "")}</li>`).join("")}</ul>
      <p>Errors share one shape: <code>{"error": {"code": "…", "message": "…"}}</code>.</p>
    </section>
    ${[...groups].map(([, list]) => list.map((entry) => operationHtml(spec, entry)).join("")).join("")}
    <section class="section" id="objects">
      <h2>Objects</h2>
      ${Object.entries(spec.components?.schemas ?? {})
        .map(([name, schema]) => `<h3 id="${schemaAnchor(name)}">${escape(name)}</h3>${schemaFields(schema, spec)}`)
        .join("")}
    </section>`;
  return layout(`API reference`, body, { current: "docs", account, railIndex });
}

function operationHtml(spec: OpenApiDocument, { method, path, operation, anchor }: Entry): string {
  const params = (operation.parameters ?? []).filter((param) => param.in === "path" || param.in === "query");
  const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
  const success = Object.entries(operation.responses).find(([status]) => status.startsWith("2"));
  const successSchema = success?.[1].content?.["application/json"]?.schema;
  return `<section class="section" id="${anchor}">
    <h2>${escape(operation.summary ?? path)}</h2>
    <p class="endpoint"><span class="method method-${method}">${method.toUpperCase()}</span><code>${escape(path)}</code></p>
    ${operation.description ? `<p>${escape(operation.description)}</p>` : ""}
    ${params.length ? `<h3>Parameters</h3>${fieldsTable(params.map((param) => ({ name: param.name, schema: param.schema ?? {}, required: param.required ?? false, note: param.description })), spec)}` : ""}
    ${requestSchema ? `<h3>Request body</h3>${schemaFields(requestSchema, spec)}` : ""}
    ${successSchema ? `<h3>Response <code>${success?.[0]}</code></h3>${schemaFields(successSchema, spec)}` : success ? `<h3>Response <code>${success[0]}</code></h3><p>${escape(success[1].description)}</p>` : ""}
    <h3>Status codes</h3>
    <ul class="statuses">${Object.entries(operation.responses).map(([status, response]) => `<li><code>${status}</code> ${escape(response.description)}</li>`).join("")}</ul>
  </section>`;
}

type Field = { name: string; schema: Schema; required: boolean; note?: string };

function schemaFields(schema: Schema, spec: OpenApiDocument): string {
  const resolved = resolve(schema, spec);
  if (!resolved.properties) return `<p>${typeHtml(schema, spec)}</p>`;
  const required = new Set(resolved.required ?? []);
  return fieldsTable(
    Object.entries(resolved.properties).map(([name, field]) => ({ name, schema: field, required: required.has(name) })),
    spec,
  );
}

function fieldsTable(fields: Field[], spec: OpenApiDocument): string {
  const rows = fields
    .map(({ name, schema, required, note }) => {
      const resolved = resolve(schema, spec);
      const description = [note ?? resolved.description, constraints(resolved), example(resolved)].filter(Boolean).join(" ");
      return `<tr>
        <td><code>${escape(name)}</code>${required ? "" : ' <span class="optional">optional</span>'}</td>
        <td>${typeHtml(schema, spec)}</td>
        <td>${escape(description)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-scroll"><table class="fields"><thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function typeHtml(schema: Schema, spec: OpenApiDocument): string {
  const ref = schema.$ref ?? schema.items?.$ref;
  const label = `<code>${escape(typeLabel(schema, spec))}</code>`;
  return ref ? `<a href="#${schemaAnchor(refName(ref))}">${label}</a>` : label;
}

function schemaAnchor(name: string): string {
  return `object-${name.toLowerCase()}`;
}

function typeLabel(schema: Schema, spec: OpenApiDocument): string {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.anyOf) return schema.anyOf.map((option) => typeLabel(option, spec)).join(" | ");
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? "object"];
  return types
    .map((type) => {
      if (type === "array" && schema.items) return `${typeLabel(schema.items, spec)}[]`;
      if (type === "string" && schema.format) return `string (${schema.format})`;
      return type;
    })
    .join(" | ");
}

function constraints(schema: Schema): string {
  if (schema.minLength !== undefined && schema.maxLength !== undefined) return `${schema.minLength} to ${schema.maxLength} characters.`;
  if (schema.maxLength !== undefined) return `Up to ${schema.maxLength} characters.`;
  return "";
}

function example(schema: Schema): string {
  return schema.example === undefined ? "" : `Example: ${JSON.stringify(schema.example)}`;
}

function resolve(schema: Schema, spec: OpenApiDocument): Schema {
  const target = schema.$ref ? (spec.components?.schemas?.[refName(schema.$ref)] ?? schema) : schema;
  if (!target.allOf) return target;
  return target.allOf
    .map((part) => resolve(part, spec))
    .reduce<Schema>(
      (merged, part) => ({
        ...merged,
        properties: { ...merged.properties, ...part.properties },
        required: [...(merged.required ?? []), ...(part.required ?? [])],
      }),
      { type: "object", description: target.description },
    );
}

function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

function groupByTag(entries: Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const tag = entry.operation.tags?.[0] ?? "Other";
    groups.set(tag, [...(groups.get(tag) ?? []), entry]);
  }
  return groups;
}

function anchorFor(summary: string): string {
  return summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
