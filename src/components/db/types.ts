export type FieldType =
  | "int"
  | "integer"
  | "string"
  | "text"
  | "boolean"
  | "bool"
  | "date"
  | "datetime"
  | "float"
  | "uuid";

export interface FieldReference {
  table: string;
  field: string;
}

export interface Field {
  name: string;
  type: FieldType | string;
  isPrimary?: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
  isAutoIncrement?: boolean;
  defaultValue?: string | number | boolean | null;
  reference?: FieldReference;
}

export interface TableSchema {
  name: string;
  fields: Field[];
}

export interface SchemaValidationError {
  table?: string;
  field?: string;
  line?: number;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
}
