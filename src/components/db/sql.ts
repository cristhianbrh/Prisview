import { analyzeSchema, type SchemaAnalysis } from "./schemaAnalysis";
import type { EnumSchema } from "./types";

export type SqlDialect = "postgres" | "mysql" | "sqlite";

function mapFieldTypeToSQL(
  type: string,
  dialect: SqlDialect,
  enumMap: Map<string, EnumSchema>,
): string {
  const normalized = type.toLowerCase();

  switch (normalized) {
    case "int":
    case "integer":
      return "INTEGER";

    case "string":
      return dialect === "mysql" ? "VARCHAR(255)" : "TEXT";

    case "text":
      return "TEXT";

    case "boolean":
    case "bool":
      return dialect === "sqlite" ? "INTEGER" : "BOOLEAN";

    case "date":
      return "DATE";

    case "datetime":
      if (dialect === "mysql") return "DATETIME";
      if (dialect === "sqlite") return "TEXT";
      return "TIMESTAMP";

    case "float":
      return dialect === "postgres" ? "REAL" : "FLOAT";

    case "uuid":
      if (dialect === "mysql") return "CHAR(36)";
      if (dialect === "sqlite") return "TEXT";
      return "UUID";

    default: {
      // Check if it's a known enum type
      const enumDef = enumMap.get(type);
      if (enumDef) {
        if (dialect === "mysql") {
          const values = enumDef.values.map((v) => `'${v}'`).join(", ");
          return `ENUM(${values})`;
        }
        if (dialect === "sqlite") {
          // Inline CHECK constraint handled separately
          return "TEXT";
        }
        // PostgreSQL: reference the created type
        return quoteIdentifier(type, dialect);
      }
      return type.toUpperCase();
    }
  }
}

function formatDefaultValue(
  value: string | number | boolean | null | undefined,
  dialect: SqlDialect = "postgres",
) {
  if (value === undefined) return null;
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);

  if (typeof value === "boolean") {
    if (dialect === "sqlite") return value ? "1" : "0";
    return value ? "TRUE" : "FALSE";
  }

  const raw = String(value).trim();
  const normalized = raw.toLowerCase();

  if (normalized === "now") return "CURRENT_TIMESTAMP";
  if (normalized === "true") return dialect === "sqlite" ? "1" : "TRUE";
  if (normalized === "false") return dialect === "sqlite" ? "0" : "FALSE";

  if (normalized === "uuid_generate_v4()") {
    return dialect === "postgres" ? raw : `'${raw}'`;
  }

  return `'${raw.replace(/'/g, "''")}'`;
}

function quoteIdentifier(name: string, dialect: SqlDialect = "postgres") {
  if (dialect === "mysql") return `\`${name}\``;
  return `"${name}"`;
}

function generateEnumDDL(
  enums: EnumSchema[],
  dialect: SqlDialect,
): string {
  if (enums.length === 0 || dialect !== "postgres") return "";

  return enums
    .map((e) => {
      const values = e.values.map((v) => `'${v}'`).join(", ");
      return `CREATE TYPE ${quoteIdentifier(e.name, dialect)} AS ENUM (${values});`;
    })
    .join("\n");
}

function generateCreateTableSQL(
  analysis: SchemaAnalysis,
  dialect: SqlDialect,
): string {
  const { enumMap } = analysis;

  return analysis.tables
    .map((table) => {
      const primaryFields = table.fields.filter((f) => f.isPrimary);
      const isCompositePk = primaryFields.length > 1;
      const lines: string[] = [];

      for (const field of table.fields) {
        const columnName = quoteIdentifier(field.name, dialect);

        const isSQLiteAutoPk =
          !isCompositePk &&
          dialect === "sqlite" &&
          field.isPrimary &&
          field.isAutoIncrement &&
          ["int", "integer"].includes(field.type.toLowerCase());

        let sqlType = mapFieldTypeToSQL(field.type, dialect, enumMap);

        if (field.isAutoIncrement) {
          if (dialect === "postgres") {
            sqlType = "SERIAL";
          } else if (dialect === "mysql") {
            sqlType = "INT";
          } else if (isSQLiteAutoPk) {
            sqlType = "INTEGER";
          }
        }

        if (isSQLiteAutoPk) {
          lines.push(`  ${columnName} INTEGER PRIMARY KEY AUTOINCREMENT`);
          continue;
        }

        const parts = [`  ${columnName}`, sqlType];

        if (field.isPrimary && !isCompositePk) parts.push("PRIMARY KEY");
        if (field.isUnique && !field.isPrimary) parts.push("UNIQUE");
        if (field.isNullable === false) parts.push("NOT NULL");
        if (field.isNullable === true && !field.isPrimary) parts.push("NULL");

        if (field.isAutoIncrement && dialect === "mysql") {
          parts.push("AUTO_INCREMENT");
        }

        const formattedDefault = formatDefaultValue(field.defaultValue, dialect);
        if (formattedDefault !== null && !field.isAutoIncrement) {
          parts.push(`DEFAULT ${formattedDefault}`);
        }

        // SQLite inline CHECK for enum types
        if (dialect === "sqlite") {
          const enumDef = enumMap.get(field.type);
          if (enumDef && enumDef.values.length > 0) {
            const allowed = enumDef.values.map((v) => `'${v}'`).join(", ");
            parts.push(`CHECK (${columnName} IN (${allowed}))`);
          }
        }

        lines.push(parts.join(" "));
      }

      if (isCompositePk) {
        const pkCols = primaryFields
          .map((f) => quoteIdentifier(f.name, dialect))
          .join(", ");
        lines.push(`  PRIMARY KEY (${pkCols})`);
      }

      for (const field of table.fields) {
        if (!field.reference) continue;

        lines.push(
          `  FOREIGN KEY (${quoteIdentifier(field.name, dialect)}) REFERENCES ${quoteIdentifier(field.reference.table, dialect)}(${quoteIdentifier(field.reference.field, dialect)})`,
        );
      }

      return `CREATE TABLE ${quoteIdentifier(table.name, dialect)} (\n${lines.join(",\n")}\n);`;
    })
    .join("\n\n");
}

export function generateSQLFromAnalysis(
  analysis: SchemaAnalysis,
  dialect: SqlDialect = "postgres",
) {
  if (!analysis.validation.valid) return "";

  const enumDDL = generateEnumDDL(analysis.enums, dialect);
  const tableDDL = generateCreateTableSQL(analysis, dialect);

  return enumDDL ? `${enumDDL}\n\n${tableDDL}` : tableDDL;
}

export function generateSQLFromText(
  text: string,
  dialect: SqlDialect = "postgres",
) {
  const analysis = analyzeSchema(text);
  return generateSQLFromAnalysis(analysis, dialect);
}
