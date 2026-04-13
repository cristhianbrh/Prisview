import type { Field, TableSchema, SchemaValidationResult } from "./types";

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

export function parseSchema(input: string): TableSchema[] {
  const lines = input.split("\n");

  const tables: TableSchema[] = [];
  let currentTable: TableSchema | null = null;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const isFieldLine = /^\s+/.test(rawLine);

    if (!isFieldLine) {
      if (currentTable) tables.push(currentTable);

      currentTable = {
        name: rawLine.trim(),
        fields: [],
      };
      continue;
    }

    if (!currentTable) continue;

    const field = parseField(rawLine);
    if (field) currentTable.fields.push(field);
  }

  if (currentTable) tables.push(currentTable);

  return tables;
}

export function validateSchema(
  tables: TableSchema[],
  sourceText?: string,
): SchemaValidationResult {
  const errors: SchemaValidationResult["errors"] = [];

  const tableMap = new Map<string, TableSchema>();
  const tableLineMap = new Map<string, number>();
  const fieldLineMap = new Map<string, number>();

  if (sourceText) {
    const lines = sourceText.split("\n");
    let currentTable: string | null = null;

    lines.forEach((rawLine, index) => {
      const lineNumber = index + 1;
      if (!rawLine.trim()) return;

      const isFieldLine = /^\s+/.test(rawLine);

      if (!isFieldLine) {
        currentTable = rawLine.trim();
        tableLineMap.set(currentTable, lineNumber);
        return;
      }

      if (!currentTable) return;

      const parts = rawLine.trim().split(/\s+/);
      if (parts.length >= 1) {
        fieldLineMap.set(`${currentTable}.${parts[0]}`, lineNumber);
      }
    });
  }

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

      const targetFieldExists = targetTable.fields.some(
        (candidate) => candidate.name === field.reference?.field,
      );

      if (!targetFieldExists) {
        errors.push({
          table: table.name,
          field: field.name,
          line: fieldLineMap.get(`${table.name}.${field.name}`),
          message: `El campo "${field.name}" referencia "${field.reference.table}.${field.reference.field}", pero ese campo no existe.`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
