import { parseSchema } from "./parser";

export type SqlDialect = "postgres" | "mysql" | "sqlite";

function mapFieldTypeToSQL(type: string, dialect: SqlDialect = "postgres") {
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
		default:
			return type.toUpperCase();
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

export function generateSQLFromText(
	text: string,
	dialect: SqlDialect = "postgres",
) {
	const tables = parseSchema(text);

	return tables
		.map((table) => {
			const lines: string[] = [];

			for (const field of table.fields) {
				const columnName = quoteIdentifier(field.name, dialect);

				const isSQLiteAutoPk =
					dialect === "sqlite" &&
					field.isPrimary &&
					field.isAutoIncrement &&
					["int", "integer"].includes(field.type.toLowerCase());

				let sqlType = mapFieldTypeToSQL(field.type, dialect);

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

				if (field.isPrimary) parts.push("PRIMARY KEY");
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

				lines.push(parts.join(" "));
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
