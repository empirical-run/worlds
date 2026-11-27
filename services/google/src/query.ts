import type { FileRecord } from "./model";

export type FileTest = (file: FileRecord) => boolean;

type Context = { rootId: string; ownerEmail: (userId: string) => string | undefined };

const TERM =
  /^(?:'((?:[^'\\]|\\.)*)'\s+in\s+(parents|owners)|(name|mimeType)\s*(=|!=|contains)\s*'((?:[^'\\]|\\.)*)'|(trashed|starred)\s*(=|!=)\s*(true|false))$/i;

export function parseQuery(input: string, context: Context): FileTest | null {
  const terms = splitAnd(input.trim());
  if (!terms) {
    return null;
  }
  const tests: FileTest[] = [];
  for (const term of terms) {
    const test = parseTerm(term, context);
    if (!test) {
      return null;
    }
    tests.push(test);
  }
  return (file) => tests.every((test) => test(file));
}

function splitAnd(input: string): string[] | null {
  if (!input) {
    return [];
  }
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (char === "\\" && quoted) {
      current += char + (input[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === "'") {
      quoted = !quoted;
    }
    const rest = input.slice(index);
    const separator = /^\s+and\s+/i.exec(rest);
    if (!quoted && separator) {
      terms.push(current.trim());
      current = "";
      index += separator[0].length - 1;
      continue;
    }
    if (!quoted && /^\s+or\s+|^not\s|^\(/i.test(rest)) {
      return null;
    }
    current += char;
  }
  if (quoted) {
    return null;
  }
  terms.push(current.trim());
  return terms;
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function parseTerm(term: string, context: Context): FileTest | null {
  const match = TERM.exec(term);
  if (!match) {
    return null;
  }
  const [, inValue, inField, field, operator, value, flag, flagOperator, flagValue] = match;
  if (inField?.toLowerCase() === "parents") {
    const parent = unescape(inValue ?? "");
    const id = parent === "root" ? context.rootId : parent;
    return (file) => file.parent === id;
  }
  if (inField?.toLowerCase() === "owners") {
    const email = unescape(inValue ?? "");
    return (file) => context.ownerEmail(file.owner) === email;
  }
  if (field) {
    const expected = unescape(value ?? "");
    const read = (file: FileRecord) => (field === "name" ? file.name : file.mime_type);
    const op = operator?.toLowerCase();
    if (op === "contains") {
      const prefix = expected.toLowerCase();
      return field === "name"
        ? (file) =>
            read(file)
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .some((word) => word.startsWith(prefix)) ||
            read(file).toLowerCase().startsWith(prefix)
        : null;
    }
    return op === "=" ? (file) => read(file) === expected : (file) => read(file) !== expected;
  }
  if (flag) {
    const wanted = flagValue?.toLowerCase() === "true";
    const read = (file: FileRecord) => (flag.toLowerCase() === "trashed" ? file.trashed : false);
    return flagOperator === "=" ? (file) => read(file) === wanted : (file) => read(file) !== wanted;
  }
  return null;
}
