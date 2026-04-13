export type FieldType =
  | "int"
  | "string"
  | "boolean"
  | "date"
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
  reference?: FieldReference;
}

export interface TableSchema {
  name: string;
  fields: Field[];
}
