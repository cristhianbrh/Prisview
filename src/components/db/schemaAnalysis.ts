import { parseSchema, validateSchema } from "./parser";
import type { Field, TableSchema, SchemaValidationResult } from "./types";

export interface SchemaAnalysis {
  text: string;
  tables: TableSchema[];
  validation: SchemaValidationResult;
  tableMap: Map<string, TableSchema>;
  fieldMap: Map<string, Field>;
  allFieldNames: string[];
}

export function analyzeSchema(text: string): SchemaAnalysis {
  const tables = parseSchema(text);
  const validation = validateSchema(tables, text);

  const tableMap = new Map<string, TableSchema>();
  const fieldMap = new Map<string, Field>();
  const allFieldNamesSet = new Set<string>();

  for (const table of tables) {
    tableMap.set(table.name, table);

    for (const field of table.fields) {
      fieldMap.set(`${table.name}.${field.name}`, field);
      allFieldNamesSet.add(field.name);
    }
  }

  return {
    text,
    tables,
    validation,
    tableMap,
    fieldMap,
    allFieldNames: Array.from(allFieldNamesSet),
  };
}
