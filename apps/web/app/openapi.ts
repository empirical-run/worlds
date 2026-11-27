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

export type OpenApiDocument = {
  info: { title: string };
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
      if (!operation) continue;
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
  return [...groups];
}

export function contentSchema(content: Content | undefined): Schema | undefined {
  return Object.values(content ?? {})[0]?.schema;
}

export function resolve(schema: Schema, spec: OpenApiDocument): Schema {
  const target = schema.$ref
    ? (spec.components?.schemas?.[refName(schema.$ref)] ?? schema)
    : schema;
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

export function fieldsOf(schema: Schema, spec: OpenApiDocument): Field[] | null {
  const resolved = resolve(schema, spec);
  if (!resolved.properties) return null;
  const required = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, field]) => ({
    name,
    schema: field,
    required: required.has(name),
  }));
}

export function typeLabel(schema: Schema): string {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.anyOf) return schema.anyOf.map(typeLabel).join(" | ");
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? "object"];
  return types
    .map((type) => {
      if (type === "array" && schema.items) return `${typeLabel(schema.items)}[]`;
      if (type === "string" && schema.format) return `string (${schema.format})`;
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

export function objectAnchor(name: string): string {
  return `object-${name.toLowerCase()}`;
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
