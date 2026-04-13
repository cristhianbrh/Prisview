import type { TableSchema } from "./types";

export function parseSchema(input: string): TableSchema[] {
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map((line) => {
      const [tableName, rawFields] = line.split(/\s+(.+)/);

      if (!tableName || !rawFields) {
        return null;
      }

      const fields = rawFields
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean)
        .map((field, index) => {
          const parts = field.split(/\s+/);
          const name = parts[0] ?? `field_${index + 1}`;
          const type = parts[1] ?? "string";
          const isPrimary = name.toLowerCase() === "id";

          return {
            name,
            type,
            isPrimary,
          };
        });

      return {
        name: tableName,
        fields,
      };
    })
    .filter((table): table is TableSchema => table !== null);
}
