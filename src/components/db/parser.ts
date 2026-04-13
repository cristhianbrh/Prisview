import type { Field, TableSchema } from "./types";

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
