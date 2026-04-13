import type { Field, TableSchema } from "./types";

function parseField(line: string): Field | null {
  const parts = line.trim().split(/\s+/);

  if (parts.length < 2) {
    return null;
  }

  const name = parts[0];
  const type = parts[1];

  let isPrimary = false;
  let reference: Field["reference"];

  let i = 2;
  while (i < parts.length) {
    const token = parts[i]?.toLowerCase();

    if (token === "pk") {
      isPrimary = true;
      i += 1;
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

  return {
    name,
    type,
    isPrimary,
    reference,
  };
}

export function parseSchema(input: string): TableSchema[] {
  const lines = input.split("\n");

  const tables: TableSchema[] = [];
  let currentTable: TableSchema | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");

    if (!line.trim()) {
      continue;
    }

    const isFieldLine = /^\s+/.test(rawLine);

    if (!isFieldLine) {
      if (currentTable) {
        tables.push(currentTable);
      }

      currentTable = {
        name: line.trim(),
        fields: [],
      };

      continue;
    }

    if (!currentTable) {
      continue;
    }

    const field = parseField(line);
    if (field) {
      currentTable.fields.push(field);
    }
  }

  if (currentTable) {
    tables.push(currentTable);
  }

  return tables;
}
