export type FieldType =
  | "int"
  | "string"
  | "boolean"
  | "date"
  | "float"
  | "uuid";

export interface Field {
  name: string;
  type: FieldType | string;
  isPrimary?: boolean;
}

export interface TableSchema {
  name: string;
  fields: Field[];
}
