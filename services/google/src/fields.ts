export type FieldMask = Map<string, FieldMask | true>;

export function parseFields(input: string): FieldMask | null {
  let position = 0;
  const text = input.replace(/\s+/g, "");

  function parseList(): FieldMask | null {
    const mask: FieldMask = new Map();
    while (position < text.length && text[position] !== ")") {
      const match = /^[A-Za-z_*][A-Za-z0-9_/*]*/.exec(text.slice(position));
      if (!match) {
        return null;
      }
      position += match[0].length;
      let sub: FieldMask | true = true;
      if (text[position] === "(") {
        position += 1;
        const inner = parseList();
        if (!inner || text[position] !== ")") {
          return null;
        }
        position += 1;
        sub = inner;
      }
      insert(mask, match[0].split("/"), sub);
      if (text[position] === ",") {
        position += 1;
      }
    }
    return mask;
  }

  const mask = parseList();
  return mask && position === text.length && mask.size ? mask : null;
}

function insert(mask: FieldMask, path: string[], sub: FieldMask | true): void {
  const [head, ...rest] = path;
  if (!head) {
    return;
  }
  if (rest.length === 0) {
    mask.set(head, sub);
    return;
  }
  const existing = mask.get(head);
  const child: FieldMask = existing instanceof Map ? existing : new Map();
  mask.set(head, child);
  insert(child, rest, sub);
}

export function applyFields(value: unknown, mask: FieldMask | true): unknown {
  if (mask === true || mask.has("*")) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyFields(item, mask));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const source = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const [key, sub] of mask) {
    if (key in source) {
      picked[key] = applyFields(source[key], sub);
    }
  }
  return picked;
}

export function unknownField(mask: FieldMask, known: ReadonlySet<string>): string | null {
  for (const key of mask.keys()) {
    if (key !== "*" && !known.has(key)) {
      return key;
    }
  }
  return null;
}
