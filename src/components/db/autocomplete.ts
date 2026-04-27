import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { analyzeSchema } from "./parser";

const staticSchemaKeywords: Completion[] = [
  { label: "pk", type: "keyword", detail: "primary key", boost: 80 },
  { label: "not null", type: "keyword", detail: "constraint", boost: 75 },
  { label: "null", type: "keyword", detail: "constraint", boost: 30 },
  { label: "unique", type: "keyword", detail: "constraint", boost: 70 },
  { label: "default", type: "keyword", detail: "constraint", boost: 65 },
  { label: "ref", type: "keyword", detail: "relation", boost: 90 },
  { label: "autoincrement", type: "keyword", detail: "constraint", boost: 60 },

  { label: "int", type: "type", boost: 70 },
  { label: "integer", type: "type", boost: 68 },
  { label: "string", type: "type", boost: 70 },
  { label: "text", type: "type", boost: 65 },
  { label: "boolean", type: "type", boost: 60 },
  { label: "bool", type: "type", boost: 58 },
  { label: "date", type: "type", boost: 55 },
  { label: "datetime", type: "type", boost: 55 },
  { label: "float", type: "type", boost: 50 },
  { label: "uuid", type: "type", boost: 50 },
];

function startsWithInsensitive(value: string, prefix: string) {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

function includesInsensitive(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

function sortCompletions(
  items: Completion[],
  query: string,
  exactFirst = true,
): Completion[] {
  const normalizedQuery = query.toLowerCase();

  return [...items].sort((a, b) => {
    const aLabel = a.label.toLowerCase();
    const bLabel = b.label.toLowerCase();

    const aExact = exactFirst && aLabel === normalizedQuery ? 1 : 0;
    const bExact = exactFirst && bLabel === normalizedQuery ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    const aStarts = aLabel.startsWith(normalizedQuery) ? 1 : 0;
    const bStarts = bLabel.startsWith(normalizedQuery) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;

    const aBoost = a.boost ?? 0;
    const bBoost = b.boost ?? 0;
    if (aBoost !== bBoost) return bBoost - aBoost;

    return aLabel.localeCompare(bLabel);
  });
}

function getLineContext(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);

  return {
    beforeCursor,
    isFieldLine: /^\s+/.test(line.text),
  };
}

function buildTableCompletions(tableNames: string[]): Completion[] {
  return tableNames.map((tableName) => ({
    label: tableName,
    type: "class",
    detail: "table",
    boost: 85,
  }));
}

function buildFieldReferenceCompletions(
  tableName: string,
  fieldNames: string[],
): Completion[] {
  return fieldNames.map((fieldName) => ({
    label: `${tableName}.${fieldName}`,
    type: "property",
    detail: "field reference",
    boost: 95,
  }));
}

function buildFieldNameOnlyCompletions(fieldNames: string[]): Completion[] {
  return fieldNames.map((fieldName) => ({
    label: fieldName,
    type: "property",
    detail: "field",
    boost: 75,
  }));
}

export function schemaCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const token = context.matchBefore(/[A-Za-z_][\w.]*/);
  const text = token?.text ?? "";
  const from = token?.from ?? context.pos;

  if (!token && !context.explicit) {
    return null;
  }

  const analysis = analyzeSchema(context.state.doc.toString());
  const tableNames = analysis.tables.map((table) => table.name);
  const { beforeCursor, isFieldLine } = getLineContext(context);

  const refTableMatch = beforeCursor.match(/\bref\s+([A-Za-z_]\w*)?$/);
  if (refTableMatch) {
    const query = refTableMatch[1] ?? "";

    return {
      from,
      options: sortCompletions(
        buildTableCompletions(tableNames).filter(
          (item) => query === "" || startsWithInsensitive(item.label, query),
        ),
        query,
      ),
      validFor: /^[A-Za-z_]\w*$/,
    };
  }

  const refTableFieldDotMatch = beforeCursor.match(
    /\bref\s+([A-Za-z_]\w*)\.([\w]*)$/,
  );

  if (refTableFieldDotMatch) {
    const tableName = refTableFieldDotMatch[1];
    const fieldPrefix = refTableFieldDotMatch[2] ?? "";
    const table = analysis.tableMap.get(tableName);

    if (!table) return null;

    return {
      from,
      options: sortCompletions(
        buildFieldReferenceCompletions(
          tableName,
          table.fields.map((field) => field.name),
        ).filter(
          (item) =>
            fieldPrefix === "" ||
            startsWithInsensitive(item.label, `${tableName}.${fieldPrefix}`),
        ),
        `${tableName}.${fieldPrefix}`,
      ),
      validFor: /^[A-Za-z_][\w.]*$/,
    };
  }

  const directTableFieldMatch = text.match(/^([A-Za-z_]\w*)\.([\w]*)$/);
  if (directTableFieldMatch) {
    const tableName = directTableFieldMatch[1];
    const fieldPrefix = directTableFieldMatch[2] ?? "";
    const table = analysis.tableMap.get(tableName);

    if (!table) return null;

    return {
      from,
      options: sortCompletions(
        buildFieldReferenceCompletions(
          tableName,
          table.fields.map((field) => field.name),
        ).filter((item) =>
          startsWithInsensitive(item.label, `${tableName}.${fieldPrefix}`),
        ),
        `${tableName}.${fieldPrefix}`,
      ),
      validFor: /^[A-Za-z_][\w.]*$/,
    };
  }

  if (isFieldLine) {
    // Suggest enum values when "default" keyword precedes the cursor
    const defaultEnumMatch = beforeCursor.match(
      /^\s+\S+\s+([A-Za-z_]\w*)\s+(?:\S+\s+)*default\s+(\w*)$/,
    );
    if (defaultEnumMatch) {
      const fieldType = defaultEnumMatch[1];
      const valuePrefix = defaultEnumMatch[2] ?? "";
      const enumDef = analysis.enumMap.get(fieldType);
      if (enumDef) {
        return {
          from,
          options: sortCompletions(
            enumDef.values
              .filter(
                (v) =>
                  valuePrefix === "" ||
                  startsWithInsensitive(v, valuePrefix),
              )
              .map((v) => ({
                label: v,
                type: "enum",
                detail: `${fieldType} value`,
                boost: 95,
              })),
            valuePrefix,
          ),
          validFor: /^[A-Za-z_]\w*$/,
        };
      }
    }

    const enumTypeOptions: Completion[] = analysis.enums.map((e) => ({
      label: e.name,
      type: "type",
      detail: "enum",
      boost: 66,
    }));

    const keywordAndTypeOptions = [
      ...staticSchemaKeywords,
      ...enumTypeOptions,
    ].filter(
      (item) =>
        text === "" ||
        startsWithInsensitive(item.label, text) ||
        includesInsensitive(item.label, text),
    );

    const fieldOptions = buildFieldNameOnlyCompletions(analysis.allFieldNames)
      .filter((item) => text === "" || startsWithInsensitive(item.label, text))
      .map((item) => ({
        ...item,
        boost: 20,
      }));

    const tableOptions = buildTableCompletions(tableNames)
      .filter((item) => text === "" || startsWithInsensitive(item.label, text))
      .map((item) => ({
        ...item,
        boost: 10,
      }));

    return {
      from,
      options: sortCompletions(
        [...keywordAndTypeOptions, ...fieldOptions, ...tableOptions],
        text,
      ),
      validFor: /^[A-Za-z_]\w*$/,
    };
  }

  const generalTableOptions = buildTableCompletions(tableNames).filter(
    (item) => text === "" || startsWithInsensitive(item.label, text),
  );

  const generalKeywordOptions = staticSchemaKeywords
    .filter(
      (item) =>
        text === "" ||
        startsWithInsensitive(item.label, text) ||
        includesInsensitive(item.label, text),
    )
    .map((item) => ({
      ...item,
      boost: (item.boost ?? 0) - 20,
    }));

  return {
    from,
    options: sortCompletions(
      [...generalTableOptions, ...generalKeywordOptions],
      text,
    ),
    validFor: /^[A-Za-z_]\w*$/,
  };
}
