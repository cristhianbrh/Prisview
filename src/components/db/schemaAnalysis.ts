import { analyzeSchema as parserAnalyzeSchema } from "./parser";
import type { Field, TableSchema, SchemaValidationResult, EnumSchema } from "./types";

export interface SchemaAnalysis {
  text: string;
  tables: TableSchema[];
  validation: SchemaValidationResult;
  tableMap: Map<string, TableSchema>;
  fieldMap: Map<string, Field>;
  allFieldNames: string[];
  enums: EnumSchema[];
  enumMap: Map<string, EnumSchema>;
}

export function analyzeSchema(text: string): SchemaAnalysis {
  const pa = parserAnalyzeSchema(text);

  const tableMap = new Map<string, TableSchema>();
  const fieldMap = new Map<string, Field>();
  const allFieldNamesSet = new Set<string>();

  for (const table of pa.tables) {
    tableMap.set(table.name, table);
    for (const field of table.fields) {
      fieldMap.set(`${table.name}.${field.name}`, field);
      allFieldNamesSet.add(field.name);
    }
  }

  return {
    text,
    tables: pa.tables,
    validation: pa.validation,
    tableMap,
    fieldMap,
    allFieldNames: Array.from(allFieldNamesSet),
    enums: pa.enums,
    enumMap: pa.enumMap,
  };
}
