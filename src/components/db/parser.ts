import type {
  Field,
  TableSchema,
  SchemaValidationResult,
  EnumSchema,
} from "./types";

export interface SchemaAnalysis {
  sourceText: string;
  tables: TableSchema[];
  tableMap: Map<string, TableSchema>;
  tableLineMap: Map<string, number>;
  fieldLineMap: Map<string, number>;
  allFieldNames: string[];
  enums: EnumSchema[];
  enumMap: Map<string, EnumSchema>;
  validation: SchemaValidationResult;
}

let lastAnalysisCache: SchemaAnalysis | null = null;

function parseDefaultValue(raw: string): string | number | boolean | null {
  const value = raw.trim();

  if (value.toLowerCase() === "null") return null;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  if (!Number.isNaN(Number(value)) && value !== "") return Number(value);

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseField(line: string): Field | null {
  const parts = line.trim().split(/\s+/);

  if (parts.length < 2) return null;

  const name = parts[0];
  const type = parts[1];

  let isPrimary = false;
  let isNullable: boolean | undefined = undefined;
  let isUnique = false;
  let isAutoIncrement = false;
  let defaultValue: Field["defaultValue"];
  let reference: Field["reference"];

  let i = 2;

  while (i < parts.length) {
    const token = parts[i]?.toLowerCase();

    if (token === "pk" || token === "primary") {
      isPrimary = true;
      isNullable = false;
      i += 1;
      continue;
    }

    if (token === "null") {
      isNullable = true;
      i += 1;
      continue;
    }

    if (token === "not" && parts[i + 1]?.toLowerCase() === "null") {
      isNullable = false;
      i += 2;
      continue;
    }

    if (token === "unique") {
      isUnique = true;
      i += 1;
      continue;
    }

    if (token === "autoincrement" || token === "increment") {
      isAutoIncrement = true;
      isNullable = false;
      i += 1;
      continue;
    }

    if (token === "default") {
      const next = parts[i + 1];
      if (next !== undefined) {
        defaultValue = parseDefaultValue(next);
      }
      i += 2;
      continue;
    }

    if (token === "ref") {
      const refValue = parts[i + 1];
      if (refValue) {
        const [table, field] = refValue.split(".");
        if (table && field) {
          reference = { table, field };
        }
      }
      i += 2;
      continue;
    }

    i += 1;
  }

  if (isNullable === undefined) {
    isNullable = !isPrimary;
  }

  return {
    name,
    type,
    isPrimary,
    isNullable,
    isUnique,
    isAutoIncrement,
    defaultValue,
    reference,
  };
}

function normalizeType(type: string) {
  const value = type.toLowerCase();

  if (value === "int") return "integer";
  if (value === "integer") return "integer";
  if (value === "string") return "string";
  if (value === "text") return "string";
  if (value === "bool") return "boolean";
  if (value === "boolean") return "boolean";
  if (value === "datetime") return "datetime";
  if (value === "date") return "date";
  if (value === "float") return "float";
  if (value === "uuid") return "uuid";

  return value;
}

function buildSourceElements(input: string): {
  tables: TableSchema[];
  enums: EnumSchema[];
} {
  const lines = input.split("\n");
  const tables: TableSchema[] = [];
  const enums: EnumSchema[] = [];
  let currentTable: TableSchema | null = null;
  let currentEnum: EnumSchema | null = null;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const isFieldLine = /^\s+/.test(rawLine);

    if (!isFieldLine) {
      if (currentTable) tables.push(currentTable);
      if (currentEnum) enums.push(currentEnum);
      currentTable = null;
      currentEnum = null;

      const trimmed = rawLine.trim();
      const enumMatch = trimmed.match(/^enum\s+([A-Za-z_]\w*)$/);
      if (enumMatch) {
        currentEnum = { name: enumMatch[1], values: [] };
      } else {
        currentTable = { name: trimmed, fields: [] };
      }
      continue;
    }

    if (currentEnum) {
      const value = rawLine.trim();
      if (value) currentEnum.values.push(value);
      continue;
    }

    if (!currentTable) continue;

    const field = parseField(rawLine);
    if (field) currentTable.fields.push(field);
  }

  if (currentTable) tables.push(currentTable);
  if (currentEnum) enums.push(currentEnum);
  return { tables, enums };
}

function buildLineMaps(sourceText: string) {
  const tableLineMap = new Map<string, number>();
  const fieldLineMap = new Map<string, number>();

  const lines = sourceText.split("\n");
  let currentTable: string | null = null;
  let inEnumBlock = false;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (!rawLine.trim()) return;

    const isFieldLine = /^\s+/.test(rawLine);

    if (!isFieldLine) {
      const trimmed = rawLine.trim();
      const enumMatch = trimmed.match(/^enum\s+([A-Za-z_]\w*)$/);
      if (enumMatch) {
        inEnumBlock = true;
        currentTable = null;
        return;
      }
      inEnumBlock = false;
      currentTable = trimmed;
      tableLineMap.set(currentTable, lineNumber);
      return;
    }

    if (inEnumBlock || !currentTable) return;

    const parts = rawLine.trim().split(/\s+/);
    if (parts.length >= 1) {
      fieldLineMap.set(`${currentTable}.${parts[0]}`, lineNumber);
    }
  });

  return { tableLineMap, fieldLineMap };
}

function validateTablesInternal(
  tables: TableSchema[],
  tableLineMap: Map<string, number>,
  fieldLineMap: Map<string, number>,
  enumMap: Map<string, EnumSchema>,
): SchemaValidationResult {
  const errors: SchemaValidationResult["errors"] = [];

  const tableMap = new Map<string, TableSchema>();

  for (const table of tables) {
    if (tableMap.has(table.name)) {
      errors.push({
        table: table.name,
        line: tableLineMap.get(table.name),
        message: `La tabla "${table.name}" está duplicada.`,
      });
      continue;
    }

    tableMap.set(table.name, table);

    const fieldNames = new Set<string>();
    let primaryKeyCount = 0;

    for (const field of table.fields) {
      if (fieldNames.has(field.name)) {
        errors.push({
          table: table.name,
          field: field.name,
          line: fieldLineMap.get(`${table.name}.${field.name}`),
          message: `El campo "${field.name}" está duplicado en la tabla "${table.name}".`,
        });
      } else {
        fieldNames.add(field.name);
      }

      if (field.isPrimary) {
        primaryKeyCount += 1;
      }

      if (
        field.isAutoIncrement &&
        !["int", "integer"].includes(field.type.toLowerCase())
      ) {
        errors.push({
          table: table.name,
          field: field.name,
          line: fieldLineMap.get(`${table.name}.${field.name}`),
          message: `El campo "${field.name}" usa autoincrement pero no es entero.`,
        });
      }
    }

    if (primaryKeyCount > 1) {
      errors.push({
        table: table.name,
        line: tableLineMap.get(table.name),
        message: `La tabla "${table.name}" tiene múltiples claves primarias y todavía no soportas clave compuesta.`,
      });
    }
  }

  for (const table of tables) {
    for (const field of table.fields) {
      if (!field.reference) continue;

      const targetTable = tableMap.get(field.reference.table);

      if (!targetTable) {
        errors.push({
          table: table.name,
          field: field.name,
          line: fieldLineMap.get(`${table.name}.${field.name}`),
          message: `El campo "${field.name}" referencia la tabla inexistente "${field.reference.table}".`,
        });
        continue;
      }

      const targetField = targetTable.fields.find(
        (candidate) => candidate.name === field.reference?.field,
      );

      if (!targetField) {
        errors.push({
          table: table.name,
          field: field.name,
          line: fieldLineMap.get(`${table.name}.${field.name}`),
          message: `El campo "${field.name}" referencia "${field.reference.table}.${field.reference.field}", pero ese campo no existe.`,
        });
        continue;
      }

      // Skip type mismatch check when either side uses an enum type.
      if (enumMap.has(field.type) || enumMap.has(targetField.type)) continue;

      const sourceType = normalizeType(field.type);
      const targetType = normalizeType(targetField.type);

      if (sourceType !== targetType) {
        errors.push({
          table: table.name,
          field: field.name,
          line: fieldLineMap.get(`${table.name}.${field.name}`),
          message: `El campo "${field.name}" es de tipo "${field.type}" pero referencia "${field.reference.table}.${targetField.name}" que es de tipo "${targetField.type}".`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function analyzeSchema(sourceText: string): SchemaAnalysis {
  if (lastAnalysisCache?.sourceText === sourceText) {
    return lastAnalysisCache;
  }

  const { tables, enums } = buildSourceElements(sourceText);
  const { tableLineMap, fieldLineMap } = buildLineMaps(sourceText);

  const allFieldNames = Array.from(
    new Set(tables.flatMap((table) => table.fields.map((field) => field.name))),
  );

  const tableMap = new Map(tables.map((table) => [table.name, table]));
  const enumMap = new Map(enums.map((e) => [e.name, e]));
  const validation = validateTablesInternal(
    tables,
    tableLineMap,
    fieldLineMap,
    enumMap,
  );

  const analysis: SchemaAnalysis = {
    sourceText,
    tables,
    tableMap,
    tableLineMap,
    fieldLineMap,
    allFieldNames,
    enums,
    enumMap,
    validation,
  };

  lastAnalysisCache = analysis;
  return analysis;
}

export function parseSchema(input: string): TableSchema[] {
  return analyzeSchema(input).tables;
}

export function validateSchema(
  tables: TableSchema[],
  sourceText?: string,
): SchemaValidationResult {
  if (typeof sourceText === "string") {
    return analyzeSchema(sourceText).validation;
  }

  const tableLineMap = new Map<string, number>();
  const fieldLineMap = new Map<string, number>();
  const enumMap = new Map<string, EnumSchema>();

  return validateTablesInternal(tables, tableLineMap, fieldLineMap, enumMap);
}
