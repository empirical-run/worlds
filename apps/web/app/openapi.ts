export type Schema = {
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

type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
  description?: string;
};

type Content = Record<string, { schema?: Schema }>;

export type Server = { url: string; description?: string };

export type Operation = {
  tags?: string[];
  servers?: Server[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Content };
  responses: Record<string, { description: string; content?: Content }>;
};

export type Tag = { name: string; description?: string };

export type OpenApiDocument = {
  info: { title: string };
  tags?: Tag[];
  servers?: Server[];
  paths: Record<string, Record<string, Operation>>;
  components?: {
    schemas?: Record<string, Schema>;
    securitySchemes?: Record<string, { description?: string }>;
  };
};

export type Field = { name: string; schema: Schema; required: boolean; note?: string };

export type Endpoint = { method: string; path: string; operation: Operation; anchor: string };

const METHODS = ["get", "post", "put", "patch", "delete"];

export function endpointsByTag(spec: OpenApiDocument): [string, Endpoint[]][] {
  const groups = new Map<string, Endpoint[]>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) {
        continue;
      }
      const tag = operation.tags?.[0] ?? "Other";
      const endpoint = {
        method,
        path,
        operation,
        anchor: slug(operation.summary ?? `${method} ${path}`),
      };
      groups.set(tag, [...(groups.get(tag) ?? []), endpoint]);
    }
  }
  const order = (spec.tags ?? []).map((tag) => tag.name);
  return [...groups].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
}

export function contentSchema(content: Content | undefined): Schema | undefined {
  return Object.values(content ?? {})[0]?.schema;
}

export function resolve(schema: Schema, spec: OpenApiDocument): Schema {
  const target = schema.$ref
    ? (spec.components?.schemas?.[refName(schema.$ref)] ?? schema)
    : schema;
  if (!target.allOf) {
    return target;
  }
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

export function fieldsOf(schema: Schema, spec: OpenApiDocument): Field[] | null {
  const resolved = resolve(schema, spec);
  if (!resolved.properties) {
    return null;
  }
  const required = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, field]) => ({
    name,
    schema: field,
    required: required.has(name),
  }));
}

export function typeLabel(schema: Schema): string {
  if (schema.$ref) {
    return refName(schema.$ref);
  }
  if (schema.anyOf) {
    return schema.anyOf.map(typeLabel).join(" | ");
  }
  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? "object"];
  return types
    .map((type) => {
      if (type === "array" && schema.items) {
        return `${typeLabel(schema.items)}[]`;
      }
      if (type === "string" && schema.format) {
        return `string (${schema.format})`;
      }
      return type;
    })
    .join(" | ");
}

export function fieldDescription(field: Field, spec: OpenApiDocument): string {
  const resolved = resolve(field.schema, spec);
  const constraint =
    resolved.minLength !== undefined && resolved.maxLength !== undefined
      ? `${resolved.minLength} to ${resolved.maxLength} characters.`
      : resolved.maxLength !== undefined
        ? `Up to ${resolved.maxLength} characters.`
        : "";
  const example =
    resolved.example === undefined ? "" : `Example: ${JSON.stringify(resolved.example)}`;
  return [field.note ?? resolved.description, constraint, example].filter(Boolean).join(" ");
}

export function linkedSchema(schema: Schema): string | null {
  const ref = schema.$ref ?? schema.items?.$ref;
  return ref ? refName(ref) : null;
}

function typesInReadingOrder(spec: OpenApiDocument): string[] {
  const seen: string[] = [];
  const visit = (schema: Schema | undefined) => {
    if (!schema) {
      return;
    }
    if (schema.$ref) {
      const name = refName(schema.$ref);
      if (seen.includes(name)) {
        return;
      }
      seen.push(name);
      visit(spec.components?.schemas?.[name]);
      return;
    }
    for (const part of [...(schema.anyOf ?? []), ...(schema.allOf ?? [])]) {
      visit(part);
    }
    visit(schema.items);
    for (const property of Object.values(schema.properties ?? {})) {
      visit(property);
    }
  };
  const endpoints = endpointsByTag(spec).flatMap(([, group]) => group);
  for (const { operation } of endpoints) {
    visit(contentSchema(operation.requestBody?.content));
    for (const [status, response] of Object.entries(operation.responses)) {
      if (status.startsWith("2")) {
        visit(contentSchema(response.content));
      }
    }
  }
  for (const { operation } of endpoints) {
    for (const response of Object.values(operation.responses)) {
      visit(contentSchema(response.content));
    }
  }
  for (const name of Object.keys(spec.components?.schemas ?? {})) {
    if (!seen.includes(name)) {
      seen.push(name);
    }
  }
  return seen;
}

export function typeAnchor(name: string): string {
  return `type-${name.toLowerCase()}`;
}

export function typeGroups(
  spec: OpenApiDocument,
  serviceTitles: readonly string[],
): { title: string; types: [string, Schema][] }[] {
  const platform = { title: "Worlds", types: [] as [string, Schema][] };
  const services = serviceTitles.map((title) => ({ title, types: [] as [string, Schema][] }));
  const schemas = spec.components?.schemas ?? {};
  const order = typesInReadingOrder(spec);
  const entries = Object.entries(schemas).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  for (const entry of entries) {
    const service = services.find((group) => entry[0].startsWith(group.title));
    (service ?? platform).types.push(entry);
  }
  return [platform, ...services];
}

function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
