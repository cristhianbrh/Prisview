export type SupportedOrmType = "prisma";

export interface OrmImportResult {
  success: boolean;
  schemaText: string;
  errors: string[];
}

interface PrismaFieldMeta {
  name: string;
  rawType: string;
  isOptional: boolean;
  attributes: string[];
}

interface PrismaModelMeta {
  name: string;
  fields: PrismaFieldMeta[];
}

function normalizeLineEndings(input: string) {
  return input.replace(/\r\n/g, "\n");
}

function stripInlineComment(line: string) {
  const commentIndex = line.indexOf("//");
  if (commentIndex === -1) return line;
  return line.slice(0, commentIndex);
}

function mapPrismaScalarToDsl(type: string): string {
  switch (type) {
    case "Int":
      return "int";
    case "BigInt":
      return "int";
    case "String":
      return "string";
    case "Boolean":
      return "boolean";
    case "DateTime":
      return "datetime";
    case "Float":
      return "float";
    case "Decimal":
      return "float";
    case "Bytes":
      return "string";
    case "Json":
      return "text";
    default:
      return type;
  }
}

function extractDefaultValue(attribute: string): string | null {
  const match = attribute.match(/^@default\((.*)\)$/);
  if (!match) return null;

  const rawValue = match[1].trim();

  if (rawValue === "autoincrement()") return null;
  if (rawValue === "now()") return "now";
  if (rawValue === "true") return "true";
  if (rawValue === "false") return "false";

  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue;
  }

  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return rawValue;
  }

  return rawValue;
}

function parsePrismaField(line: string): PrismaFieldMeta | null {
  const cleanLine = stripInlineComment(line).trim();
  if (!cleanLine) return null;

  if (cleanLine.startsWith("@@")) return null;
  if (cleanLine.startsWith("@")) return null;

  const parts = cleanLine.split(/\s+/);
  if (parts.length < 2) return null;

  const name = parts[0];
  const rawTypeToken = parts[1];
  const rawType = rawTypeToken.replace(/\?$/, "");
  const isOptional = rawTypeToken.endsWith("?");
  const attributes = parts.slice(2);

  return {
    name,
    rawType,
    isOptional,
    attributes,
  };
}

function parsePrismaModels(input: string): PrismaModelMeta[] {
  const text = normalizeLineEndings(input);
  const lines = text.split("\n");

  const models: PrismaModelMeta[] = [];
  let currentModel: PrismaModelMeta | null = null;
  let insideModel = false;

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();

    if (!line) continue;

    const modelStart = line.match(/^model\s+([A-Za-z_]\w*)\s*\{$/);
    if (modelStart) {
      currentModel = {
        name: modelStart[1],
        fields: [],
      };
      insideModel = true;
      continue;
    }

    if (insideModel && line === "}") {
      if (currentModel) {
        models.push(currentModel);
      }
      currentModel = null;
      insideModel = false;
      continue;
    }

    if (!insideModel || !currentModel) continue;

    const field = parsePrismaField(line);
    if (field) {
      currentModel.fields.push(field);
    }
  }

  return models;
}

function findRelationInfo(attribute: string): {
  relationFieldName: string;
  referencedFieldName: string;
} | null {
  const relationMatch = attribute.match(
    /@relation\(\s*fields:\s*\[\s*([A-Za-z_]\w*)\s*\]\s*,\s*references:\s*\[\s*([A-Za-z_]\w*)\s*\]\s*\)/,
  );

  if (!relationMatch) return null;

  return {
    relationFieldName: relationMatch[1],
    referencedFieldName: relationMatch[2],
  };
}

function buildRelationMap(models: PrismaModelMeta[]) {
  const relationMap = new Map<string, { table: string; field: string }>();

  for (const model of models) {
    for (const field of model.fields) {
      const modelReference = models.find(
        (candidate) => candidate.name === field.rawType,
      );
      if (!modelReference) continue;

      for (const attribute of field.attributes) {
        const relationInfo = findRelationInfo(attribute);
        if (!relationInfo) continue;

        relationMap.set(`${model.name}.${relationInfo.relationFieldName}`, {
          table: field.rawType,
          field: relationInfo.referencedFieldName,
        });
      }
    }
  }

  return relationMap;
}

function convertPrismaModelToDsl(
  model: PrismaModelMeta,
  relationMap: Map<string, { table: string; field: string }>,
  allModelNames: Set<string>,
): string {
  const lines: string[] = [model.name];

  for (const field of model.fields) {
    // Saltar campos relacionales no escalares como "posts Post[]", "user User"
    if (allModelNames.has(field.rawType)) {
      continue;
    }

    const parts: string[] = [field.name, mapPrismaScalarToDsl(field.rawType)];

    const isId = field.attributes.includes("@id");
    const isUnique = field.attributes.includes("@unique");
    const hasAutoincrement = field.attributes.includes(
      "@default(autoincrement())",
    );

    if (isId) {
      parts.push("pk");
    }

    if (field.isOptional && !isId) {
      parts.push("null");
    } else if (!field.isOptional) {
      parts.push("not", "null");
    }

    if (isUnique && !isId) {
      parts.push("unique");
    }

    if (hasAutoincrement) {
      parts.push("autoincrement");
    }

    const defaultAttribute = field.attributes.find((attribute) =>
      attribute.startsWith("@default("),
    );

    const defaultValue = defaultAttribute
      ? extractDefaultValue(defaultAttribute)
      : null;

    if (defaultValue !== null && !hasAutoincrement) {
      parts.push("default", defaultValue);
    }

    const relation = relationMap.get(`${model.name}.${field.name}`);
    if (relation) {
      parts.push("ref", `${relation.table}.${relation.field}`);
    }

    lines.push(`  ${parts.join(" ")}`);
  }

  return lines.join("\n");
}

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
    };
  }

  if (ormType !== "prisma") {
    return {
      success: false,
      schemaText: "",
      errors: [`ORM no soportado todavía: ${ormType}`],
    };
  }

  const models = parsePrismaModels(trimmed);

  if (models.length === 0) {
    return {
      success: false,
      schemaText: "",
      errors: [
        "No encontré bloques model válidos de Prisma.",
        "Esta primera versión solo importa modelos Prisma tipo: model User { ... }",
      ],
    };
  }

  const allModelNames = new Set(models.map((model) => model.name));
  const relationMap = buildRelationMap(models);

  const schemaText = models
    .map((model) => convertPrismaModelToDsl(model, relationMap, allModelNames))
    .join("\n\n")
    .trim();

  if (!schemaText) {
    return {
      success: false,
      schemaText: "",
      errors: [
        "La conversión no produjo tablas exportables.",
        "Revisa si tus modelos solo tenían relaciones sin campos escalares persistidos.",
      ],
    };
  }

  return {
    success: true,
    schemaText,
    errors: [],
  };
}
