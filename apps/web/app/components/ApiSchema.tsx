import {
  fieldDescription,
  fieldsOf,
  linkedSchema,
  typeAnchor,
  typeLabel,
  type Field,
  type OpenApiDocument,
  type Schema,
} from "../openapi";

export function SchemaFields({ schema, spec }: { schema: Schema; spec: OpenApiDocument }) {
  const fields = fieldsOf(schema, spec);
  return fields ? (
    <FieldsTable fields={fields} spec={spec} />
  ) : (
    <p>
      <TypeName schema={schema} />
    </p>
  );
}

export function FieldsTable({ fields, spec }: { fields: Field[]; spec: OpenApiDocument }) {
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
  return linked ? <a href={`/docs/types#${typeAnchor(linked)}`}>{label}</a> : label;
}
