import type { ParsedSchema } from "./prisma.js";

/** The canonical columns eco-faker emits for each table, mirroring src/output/sql.ts. */
export const CANONICAL_COLUMNS: Record<string, string[]> = {
  users: ["id", "first_name", "last_name", "email", "locale", "created_at", "address"],
  carts: [
    "id",
    "user_id",
    "status",
    "items",
    "created_at",
    "last_activity_date",
    "abandonment_timeout_hours",
    "currency",
  ],
  abandoned_checkouts: [
    "id",
    "cart_id",
    "user_id",
    "exit_timestamp",
    "recovery_email_sent",
    "recovery_email_sent_at",
    "coupon_code_offered",
    "recovered",
  ],
  orders: [
    "id",
    "cart_id",
    "user_id",
    "items",
    "subtotal",
    "tax",
    "shipping",
    "total",
    "currency",
    "created_at",
    "shipping_address",
    "status",
  ],
  shipments: [
    "id",
    "order_id",
    "tracking_number",
    "carrier",
    "package_index",
    "total_packages",
    "items",
    "status",
    "delayed",
    "events",
  ],
  return_requests: [
    "id",
    "order_id",
    "user_id",
    "reason",
    "status",
    "refund_amount",
    "requested_at",
    "resolved_at",
  ],
};

export interface ColumnMapping {
  targetColumn: string;
  confidence: number; // 0..1
}

/** canonicalTable -> canonicalColumn -> mapping (also carries the matched target model name per table) */
export type SchemaMapping = Record<
  string,
  { targetModel: string | null; columns: Record<string, ColumnMapping> }
>;

function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // camelCase -> snake_case boundary
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function singularize(word: string): string {
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function tokenOverlapScore(a: string[], b: string[]): number {
  const setB = new Set(b.map(singularize));
  let overlap = 0;
  for (const token of a) {
    if (setB.has(singularize(token))) overlap++;
  }
  return overlap / Math.max(a.length, b.length, 1);
}

/** Best-effort match between our canonical table name and a schema model name. */
function matchModel(tableName: string, modelNames: string[]): string | null {
  const tableTokens = tokenize(tableName);
  let best: { name: string; score: number } | null = null;

  for (const modelName of modelNames) {
    const score = tokenOverlapScore(tableTokens, tokenize(modelName));
    if (!best || score > best.score) best = { name: modelName, score };
  }

  return best && best.score > 0.3 ? best.name : null;
}

/** Best-effort match between one of our canonical column names and a model's field list. */
function matchColumn(columnName: string, fieldNames: string[]): ColumnMapping {
  const columnTokens = tokenize(columnName);
  let best: { name: string; score: number } | null = null;

  for (const fieldName of fieldNames) {
    const score = tokenOverlapScore(columnTokens, tokenize(fieldName));
    if (!best || score > best.score) best = { name: fieldName, score };
  }

  if (best && best.score >= 0.4) {
    return { targetColumn: best.name, confidence: Math.round(best.score * 100) / 100 };
  }
  // No confident match: fall back to our own canonical name so output stays valid,
  // but flag zero confidence so the human reviewing mapping.json knows to check it.
  return { targetColumn: columnName, confidence: 0 };
}

/**
 * Build a full table/column mapping from a parsed schema. Tables whose
 * model isn't found in the schema get `targetModel: null` and every column
 * falls back to the canonical name with confidence 0 (nothing to map to).
 */
export function buildSchemaMapping(
  schema: ParsedSchema,
  tables: string[] = Object.keys(CANONICAL_COLUMNS)
): SchemaMapping {
  const modelNames = Object.keys(schema.models);
  const mapping: SchemaMapping = {};

  for (const table of tables) {
    const canonicalColumns = CANONICAL_COLUMNS[table];
    if (!canonicalColumns) continue;

    const targetModel = matchModel(table, modelNames);
    const fields = targetModel ? schema.models[targetModel] : [];

    const columns: Record<string, ColumnMapping> = {};
    for (const column of canonicalColumns) {
      columns[column] = fields.length > 0 ? matchColumn(column, fields) : { targetColumn: column, confidence: 0 };
    }

    mapping[table] = { targetModel, columns };
  }

  return mapping;
}
