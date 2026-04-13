import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { parseSchema } from "./parser";

const staticSchemaKeywords: Completion[] = [
  { label: "pk", type: "keyword" },
  { label: "not null", type: "keyword" },
  { label: "null", type: "keyword" },
  { label: "unique", type: "keyword" },
  { label: "default", type: "keyword" },
  { label: "ref", type: "keyword" },
  { label: "autoincrement", type: "keyword" },
  { label: "int", type: "type" },
  { label: "integer", type: "type" },
  { label: "string", type: "type" },
  { label: "text", type: "type" },
  { label: "boolean", type: "type" },
  { label: "bool", type: "type" },
  { label: "date", type: "type" },
  { label: "datetime", type: "type" },
  { label: "float", type: "type" },
  { label: "uuid", type: "type" },
];

export function schemaCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][\w.]*/);
  const text = word?.text ?? "";
  const from = word?.from ?? context.pos;

  if (!word && !context.explicit) {
    return null;
  }

  const doc = context.state.doc.toString();
  const tables = parseSchema(doc);
  const tableMap = new Map(tables.map((table) => [table.name, table]));

  const currentLine = context.state.doc.lineAt(context.pos);
  const beforeCursor = currentLine.text.slice(0, context.pos - currentLine.from);

  if (/\bref\s+[A-Za-z_]*$/.test(beforeCursor)) {
    return {
      from,
      options: tables.map((table) => ({
        label: table.name,
        type: "class",
      })),
    };
  }

  const tableDotMatch = text.match(/^([A-Za-z_]\w*)\.$/);
  if (tableDotMatch) {
    const tableName = tableDotMatch[1];
    const table = tableMap.get(tableName);
    if (!table) return null;

    return {
      from,
      options: table.fields.map((field) => ({
        label: `${tableName}.${field.name}`,
        type: "property",
      })),
      validFor: /^[A-Za-z_][\w.]*$/,
    };
  }

  const tableFieldMatch = text.match(/^([A-Za-z_]\w*)\.([\w]*)$/);
  if (tableFieldMatch) {
    const tableName = tableFieldMatch[1];
    const fieldPrefix = tableFieldMatch[2].toLowerCase();
    const table = tableMap.get(tableName);
    if (!table) return null;

    return {
      from,
      options: table.fields
        .filter((field) => field.name.toLowerCase().startsWith(fieldPrefix))
        .map((field) => ({
          label: `${tableName}.${field.name}`,
          type: "property",
        })),
      validFor: /^[A-Za-z_][\w.]*$/,
    };
  }

  const tableOptions: Completion[] = tables.map((table) => ({
    label: table.name,
    type: "class",
  }));

  return {
    from,
    options: [...staticSchemaKeywords, ...tableOptions],
    validFor: /^[A-Za-z_]\w*$/,
  };
}