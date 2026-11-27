import { readFileSync } from "node:fs";

const [specPath = "packages/makeworlds/openapi.json"] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const problems = [];

function walk(schema, path) {
  if (!schema || typeof schema !== "object" || "$ref" in schema) return;
  for (const key of ["anyOf", "oneOf", "allOf"])
    for (const part of schema[key] ?? []) walk(part, path);
  if (schema.items) walk(schema.items, `${path}[]`);
  if (schema.properties) {
    problems.push(`${path}: inline object; register it with .openapi("Name", { description })`);
    return;
  }
  if (typeof schema.additionalProperties === "object")
    walk(schema.additionalProperties, `${path}{}`);
}

for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
  if (!schema.description?.trim()) problems.push(`${name}: no description`);
  for (const part of [schema, ...(schema.allOf ?? [])])
    for (const [field, property] of Object.entries(part.properties ?? {}))
      walk(property, `${name}.${field}`);
}

for (const [path, operations] of Object.entries(spec.paths ?? {}))
  for (const [method, operation] of Object.entries(operations)) {
    const where = `${method.toUpperCase()} ${path}`;
    const bodies = [
      ["request", operation.requestBody?.content],
      ...Object.entries(operation.responses ?? {}).map(([status, response]) => [
        status,
        response.content,
      ]),
    ];
    for (const [label, content] of bodies)
      for (const [type, media] of Object.entries(content ?? {}))
        if (type.includes("json")) walk(media.schema, `${where} ${label}`);
  }

if (problems.length) {
  console.error(`${specPath}: ${problems.length} undocumented schemas\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`${specPath}: every schema is named and described`);
