export type SupportedOrmType = "prisma";

export interface OrmImportResult {
  success: boolean;
  schemaText: string;
  errors: string[];
  warnings: string[];
}

interface PrismaFieldMeta {
  name: string;
  rawType: string;
  isOptional: boolean;
  isArray: boolean;
  attributes: string[];
}

interface PrismaModelMeta {
  name: string;
  fields: PrismaFieldMeta[];
  hasCompositeId: boolean;
}

interface PrismaEnumMeta {
  name: string;
  values: string[];
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function normalizeLineEndings(input: string) {
  return input.replace(/\r\n/g, "\n");
}

function stripInlineComment(line: string) {
  // Only strip // that are not inside a string literal
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!inString && (ch === '"' || ch === "'")) {
      inString = true;
      stringChar = ch;
    } else if (inString && ch === stringChar) {
      inString = false;
    } else if (!inString && ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Tokenize a Prisma field line respecting parentheses and brackets so that
 * multi-word attribute arguments (e.g. `@default("hello world")`) stay together.
 */
function tokenizePrismaLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of line) {
    if (char === "(" || char === "[" || char === "{") {
      depth++;
      current += char;
    } else if (char === ")" || char === "]" || char === "}") {
      depth--;
      current += char;
    } else if ((char === " " || char === "\t") && depth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// ---------------------------------------------------------------------------
// Prisma → DSL type mapping
// ---------------------------------------------------------------------------

function mapPrismaScalarToDsl(type: string): string {
  switch (type) {
    case "Int":
    case "BigInt":
      return "int";
    case "String":
      return "string";
    case "Boolean":
      return "boolean";
    case "DateTime":
      return "datetime";
    case "Float":
    case "Decimal":
      return "float";
    case "Bytes":
      return "string";
    case "Json":
      return "text";
    default:
      // Enum types and unknown types are returned as-is
      return type;
  }
}

/**
 * Extract the `@db.*` native-type hint from an attribute list and use it to
 * refine the DSL type when the Prisma scalar alone is ambiguous.
 */
function mapTypeWithDbHint(rawType: string, attributes: string[]): string {
  const dbAttr = attributes.find((a) => a.startsWith("@db."));
  if (dbAttr) {
    const hint = (dbAttr.match(/^@db\.(\w+)/) ?? [])[1]?.toLowerCase();
    if (hint) {
      if (hint === "uuid") return "uuid";
      if (
        hint === "text" ||
        hint === "longtext" ||
        hint === "mediumtext" ||
        hint === "clob"
      )
        return "text";
      if (hint === "json" || hint === "jsonb") return "text";
      if (hint === "smallint" || hint === "tinyint") return "int";
      if (hint === "decimal" || hint === "numeric") return "float";
      if (hint === "doubleprecision" || hint === "real") return "float";
      if (hint === "timestamp" || hint === "datetime") return "datetime";
      if (hint === "date") return "date";
      if (
        hint === "varchar" ||
        hint === "char" ||
        hint === "nvarchar" ||
        hint === "nchar"
      )
        return "string";
    }
  }
  return mapPrismaScalarToDsl(rawType);
}

// ---------------------------------------------------------------------------
// Default-value extraction
// ---------------------------------------------------------------------------

function extractDefaultValue(attribute: string): string | null {
  const match = attribute.match(/^@default\((.*)\)$/s);
  if (!match) return null;

  const rawValue = match[1].trim();

  // Skip server-side generation functions
  if (rawValue === "autoincrement()") return null;
  if (
    rawValue === "uuid()" ||
    rawValue === "cuid()" ||
    rawValue === "nanoid()" ||
    rawValue === "dbgenerated()"
  )
    return null;

  if (rawValue === "now()") return "now";
  if (rawValue === "true") return "true";
  if (rawValue === "false") return "false";

  // Quoted string
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue;
  }

  // Numeric
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return rawValue;
  }

  // Enum value or any other identifier
  return rawValue;
}

// ---------------------------------------------------------------------------
// Relation parsing
// ---------------------------------------------------------------------------

function findRelationFields(attribute: string): {
  fields: string[];
  references: string[];
} | null {
  // Support multi-field relations: fields: [a, b], references: [x, y]
  const match = attribute.match(
    /@relation\([^)]*fields:\s*\[([^\]]*)\][^)]*references:\s*\[([^\]]*)\]/,
  );
  if (!match) return null;

  const fields = match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const references = match[2]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { fields, references };
}

// ---------------------------------------------------------------------------
// Prisma schema block parsers
// ---------------------------------------------------------------------------

function parsePrismaField(line: string): PrismaFieldMeta | null {
  const cleanLine = stripInlineComment(line).trim();
  if (!cleanLine) return null;
  if (cleanLine.startsWith("@@") || cleanLine.startsWith("@")) return null;

  const tokens = tokenizePrismaLine(cleanLine);
  if (tokens.length < 2) return null;

  const name = tokens[0];
  const rawTypeToken = tokens[1];

  // Strip modifier suffixes: ?, [], ?[]
  const rawType = rawTypeToken.replace(/[?[\]]+$/, "");
  const isOptional = rawTypeToken.includes("?");
  const isArray = rawTypeToken.includes("[]");

  const attributes = tokens.slice(2).filter((t) => t.startsWith("@"));

  return { name, rawType, isOptional, isArray, attributes };
}

function parsePrismaModels(input: string): PrismaModelMeta[] {
  const text = normalizeLineEndings(input);
  const lines = text.split("\n");

  const models: PrismaModelMeta[] = [];
  let currentModel: (PrismaModelMeta & { mappedName: string | null }) | null =
    null;
  let insideModel = false;

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;

    const modelStart = line.match(/^model\s+([A-Za-z_]\w*)\s*\{$/);
    if (modelStart && !insideModel) {
      currentModel = {
        name: modelStart[1],
        mappedName: null,
        fields: [],
        hasCompositeId: false,
      };
      insideModel = true;
      continue;
    }

    if (insideModel && line === "}") {
      if (currentModel) {
        models.push({
          name: currentModel.mappedName ?? currentModel.name,
          fields: currentModel.fields,
          hasCompositeId: currentModel.hasCompositeId,
        });
      }
      currentModel = null;
      insideModel = false;
      continue;
    }

    if (!insideModel || !currentModel) continue;

    // @@map — use the mapped (database) table name
    const tableMapMatch = line.match(/^@@map\(["']([^"']+)["']\)/);
    if (tableMapMatch) {
      currentModel.mappedName = tableMapMatch[1];
      continue;
    }

    // @@id([...]) — composite primary key
    if (line.startsWith("@@id(")) {
      currentModel.hasCompositeId = true;
      continue;
    }

    // Skip other block-level attributes
    if (line.startsWith("@@")) continue;

    const field = parsePrismaField(line);
    if (field) currentModel.fields.push(field);
  }

  return models;
}

function parsePrismaEnums(input: string): PrismaEnumMeta[] {
  const text = normalizeLineEndings(input);
  const lines = text.split("\n");

  const enums: PrismaEnumMeta[] = [];
  let currentEnum: (PrismaEnumMeta & { mappedName: string | null }) | null =
    null;
  let insideEnum = false;

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;

    const enumStart = line.match(/^enum\s+([A-Za-z_]\w*)\s*\{$/);
    if (enumStart && !insideEnum) {
      currentEnum = { name: enumStart[1], mappedName: null, values: [] };
      insideEnum = true;
      continue;
    }

    if (insideEnum && line === "}") {
      if (currentEnum) {
        enums.push({
          name: currentEnum.mappedName ?? currentEnum.name,
          values: currentEnum.values,
        });
      }
      currentEnum = null;
      insideEnum = false;
      continue;
    }

    if (!insideEnum || !currentEnum) continue;

    // @@map on enum renames the database type
    const enumMapMatch = line.match(/^@@map\(["']([^"']+)["']\)/);
    if (enumMapMatch) {
      currentEnum.mappedName = enumMapMatch[1];
      continue;
    }

    // Skip block attributes and field-level attributes
    if (line.startsWith("@@") || line.startsWith("@")) continue;

    // Each non-attribute line is an enum value identifier
    const valueMatch = line.match(/^([A-Za-z_]\w*)/);
    if (valueMatch) currentEnum.values.push(valueMatch[1]);
  }

  return enums;
}

// ---------------------------------------------------------------------------
// Relation map builder
// ---------------------------------------------------------------------------

function buildRelationMap(
  models: PrismaModelMeta[],
  allModelNames: Set<string>,
) {
  const relationMap = new Map<string, { table: string; field: string }>();

  for (const model of models) {
    for (const field of model.fields) {
      if (!allModelNames.has(field.rawType)) continue;

      for (const attribute of field.attributes) {
        const relationInfo = findRelationFields(attribute);
        if (!relationInfo) continue;

        for (let i = 0; i < relationInfo.fields.length; i++) {
          const relField = relationInfo.fields[i];
          const refField = relationInfo.references[i];
          if (relField && refField) {
            relationMap.set(`${model.name}.${relField}`, {
              table: field.rawType,
              field: refField,
            });
          }
        }
      }
    }
  }

  return relationMap;
}

// ---------------------------------------------------------------------------
// DSL converters
// ---------------------------------------------------------------------------

function convertPrismaEnumToDsl(e: PrismaEnumMeta): string {
  const lines = [`enum ${e.name}`];
  for (const value of e.values) {
    lines.push(`  ${value}`);
  }
  return lines.join("\n");
}

function convertPrismaModelToDsl(
  model: PrismaModelMeta,
  relationMap: Map<string, { table: string; field: string }>,
  allModelNames: Set<string>,
  enumNames: Set<string>,
): { dsl: string; skippedArrayFields: string[] } {
  const lines: string[] = [model.name];
  const skippedArrayFields: string[] = [];

  for (const field of model.fields) {
    // Skip back-reference / list relation fields (e.g. `posts Post[]`, `user User`)
    if (allModelNames.has(field.rawType)) continue;

    // Skip @ignore fields
    if (field.attributes.some((a) => a === "@ignore")) continue;

    // Skip array scalars (PostgreSQL arrays / unsupported in DSL)
    if (field.isArray && !enumNames.has(field.rawType)) {
      skippedArrayFields.push(field.name);
      continue;
    }

    // Resolve actual field name (handle @map)
    const mapAttr = field.attributes.find((a) => a.startsWith("@map("));
    const fieldName = mapAttr
      ? ((mapAttr.match(/@map\(["']([^"']+)["']\)/) ?? [])[1] ?? field.name)
      : field.name;

    // Determine DSL type
    const dslType = enumNames.has(field.rawType)
      ? field.rawType
      : mapTypeWithDbHint(field.rawType, field.attributes);

    const parts: string[] = [fieldName, dslType];

    const isId = field.attributes.includes("@id");
    // @unique may carry parameters: @unique or @unique(map: "name")
    const isUnique = field.attributes.some(
      (a) => a === "@unique" || a.startsWith("@unique("),
    );
    const hasAutoincrement = field.attributes.some((a) =>
      a.startsWith("@default(autoincrement"),
    );

    if (isId) parts.push("pk");

    if (field.isOptional && !isId) {
      parts.push("null");
    } else if (!field.isOptional) {
      parts.push("not", "null");
    }

    if (isUnique && !isId) parts.push("unique");
    if (hasAutoincrement) parts.push("autoincrement");

    const defaultAttr = field.attributes.find((a) =>
      a.startsWith("@default("),
    );
    const defaultValue = defaultAttr ? extractDefaultValue(defaultAttr) : null;
    if (defaultValue !== null && !hasAutoincrement) {
      parts.push("default", defaultValue);
    }

    const relation = relationMap.get(`${model.name}.${fieldName}`) ??
      relationMap.get(`${model.name}.${field.name}`);
    if (relation) {
      parts.push("ref", `${relation.table}.${relation.field}`);
    }

    lines.push(`  ${parts.join(" ")}`);
  }

  return { dsl: lines.join("\n"), skippedArrayFields };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function convertOrmToDsl(
  ormType: SupportedOrmType,
  input: string,
): OrmImportResult {
  const trimmed = normalizeLineEndings(input).trim();

  if (!trimmed) {
    return {
      success: false,
      schemaText: "",
      errors: ["No hay contenido para importar."],
      warnings: [],
    };
  }

  if (ormType !== "prisma") {
    return {
      success: false,
      schemaText: "",
      errors: [`ORM no soportado todavía: ${ormType}`],
      warnings: [],
    };
  }

  const models = parsePrismaModels(trimmed);
  const prismaEnums = parsePrismaEnums(trimmed);

  if (models.length === 0 && prismaEnums.length === 0) {
    return {
      success: false,
      schemaText: "",
      errors: [
        "No encontré bloques model ni enum válidos de Prisma.",
        "Formato esperado: model User { ... } / enum Role { ... }",
      ],
      warnings: [],
    };
  }

  const allModelNames = new Set(models.map((m) => m.name));
  const enumNames = new Set(prismaEnums.map((e) => e.name));
  const relationMap = buildRelationMap(models, allModelNames);

  const warnings: string[] = [];
  const parts: string[] = [];

  // Enums first
  for (const e of prismaEnums) {
    if (e.values.length === 0) {
      warnings.push(`El enum "${e.name}" no tiene valores y se omitió.`);
      continue;
    }
    parts.push(convertPrismaEnumToDsl(e));
  }

  // Then models
  for (const model of models) {
    const { dsl, skippedArrayFields } = convertPrismaModelToDsl(
      model,
      relationMap,
      allModelNames,
      enumNames,
    );

    parts.push(dsl);

    if (model.hasCompositeId) {
      warnings.push(
        `"${model.name}" usa clave primaria compuesta (@@id) — no representable en DSL, importado sin pk.`,
      );
    }

    if (skippedArrayFields.length > 0) {
      warnings.push(
        `En "${model.name}" se omitieron los campos array (no soportados en DSL): ${skippedArrayFields.join(", ")}.`,
      );
    }
  }

  const schemaText = parts.join("\n\n").trim();

  if (!schemaText) {
    return {
      success: false,
      schemaText: "",
      errors: [
        "La conversión no produjo tablas ni enums exportables.",
        "Revisa si tus modelos solo tenían relaciones sin campos escalares persistidos.",
      ],
      warnings,
    };
  }

  return {
    success: true,
    schemaText,
    errors: [],
    warnings,
  };
}
