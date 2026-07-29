import { createHash } from "node:crypto";
import { Faker, en } from "@faker-js/faker";

/** Minimal shape of `pg`'s Client this module needs -- same pattern as `lint.ts`'s `PgClientLike`, avoiding a hard @types/pg dependency for an optional codepath. */
interface PgClientLike {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

async function connectPg(databaseUrl: string): Promise<PgClientLike> {
  // Dynamic + loosely-typed import so `pg` stays a fully optional
  // dependency, same reasoning as lint.ts's lintSqlAgainstDatabase: most
  // users never touch a live database from this tool and shouldn't be
  // forced to install a Postgres client for the rest of it to work.
  let pgModule: { Client: new (config: { connectionString: string }) => PgClientLike };
  try {
    pgModule = (await import(/* @vite-ignore */ "pg" as string)) as unknown as {
      Client: new (config: { connectionString: string }) => PgClientLike;
    };
  } catch {
    throw new Error("db-snapshot requires the optional 'pg' package. Install it with: npm install pg");
  }
  const client = new pgModule.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

export async function listTables(client: PgClientLike, schema = "public"): Promise<string[]> {
  const result = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
    [schema]
  );
  return result.rows.map((r) => r.table_name as string);
}

export async function listColumns(client: PgClientLike, table: string, schema = "public"): Promise<string[]> {
  const result = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
    [schema, table]
  );
  return result.rows.map((r) => r.column_name as string);
}

/**
 * What kind of PII a column *looks like it holds*, purely from its name.
 * This is a heuristic, stated plainly as one -- a column literally named
 * `name` holding a product name, not a person's, would be a real false
 * positive. `--exclude-anonymize table.column` exists specifically to
 * override an auto-detection that's wrong for a given schema;
 * `--anonymize table.column` exists to catch a real PII column this
 * heuristic misses (e.g. a company-specific field like `slack_handle`).
 */
export type PiiKind =
  | "email"
  | "ssn"
  | "credit_card"
  | "phone"
  | "ip_address"
  | "date_of_birth"
  | "first_name"
  | "last_name"
  | "full_name"
  | "address"
  | "generic_secret";

// Ordered most-specific to least-specific -- `first_name`/`last_name` must
// be checked before the generic `full_name` pattern (which would otherwise
// match "name" inside "first_name" first and misclassify it).
const PII_PATTERNS: { kind: PiiKind; pattern: RegExp }[] = [
  { kind: "email", pattern: /e[-_]?mail/i },
  { kind: "ssn", pattern: /\bssn\b|social_?security/i },
  { kind: "credit_card", pattern: /credit_?card|card_?number|\bcvv\b/i },
  { kind: "phone", pattern: /phone|mobile|\bcell\b/i },
  { kind: "ip_address", pattern: /ip_?address|^ip$/i },
  { kind: "date_of_birth", pattern: /date_?of_?birth|\bdob\b|birth_?date/i },
  { kind: "first_name", pattern: /first_?name|given_?name/i },
  { kind: "last_name", pattern: /last_?name|surname|family_?name/i },
  { kind: "address", pattern: /address|street/i },
  { kind: "full_name", pattern: /^name$|full_?name|customer_?name|contact_?name/i },
  { kind: "generic_secret", pattern: /password|passwd|secret|\btoken\b|api_?key/i },
];

export function classifyColumn(columnName: string): PiiKind | null {
  for (const { kind, pattern } of PII_PATTERNS) {
    if (pattern.test(columnName)) return kind;
  }
  return null;
}

/**
 * Deterministically derive a 32-bit seed from a real value's SHA-256 hash.
 * The same input value ALWAYS produces the same seed, and therefore the
 * same fake replacement -- this is what keeps repeated real values (the
 * same customer's email appearing in multiple tables, or multiple times
 * in the same table) consistent with each other in the anonymized output,
 * without ever storing a reversible mapping from fake back to real.
 */
function seedFromValue(value: string): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

/** A deterministic, irreversible replacement for one real value, shaped like the kind of PII the column appears to hold. */
export function anonymizeValue(kind: PiiKind, rawValue: unknown): unknown {
  if (rawValue === null || rawValue === undefined) return rawValue;
  const str = String(rawValue);
  const faker = new Faker({ locale: [en] });
  faker.seed(seedFromValue(str));

  switch (kind) {
    case "email":
      return faker.internet.email().toLowerCase();
    case "phone":
      return faker.phone.number();
    case "ssn":
      return `${faker.number.int({ min: 100, max: 999 })}-${faker.number.int({ min: 10, max: 99 })}-${faker.number.int({ min: 1000, max: 9999 })}`;
    case "credit_card":
      return faker.finance.creditCardNumber();
    case "ip_address":
      return faker.internet.ip();
    case "date_of_birth":
      return faker.date.birthdate().toISOString().slice(0, 10);
    case "first_name":
      return faker.person.firstName();
    case "last_name":
      return faker.person.lastName();
    case "full_name":
      return faker.person.fullName();
    case "address":
      return faker.location.streetAddress();
    case "generic_secret":
      // Not faked as a plausible-looking secret -- a real password/token
      // hash should never be replaced with something that LOOKS like a
      // valid credential. Redacted to an opaque, clearly-fake marker instead.
      return str.length === 0 ? "[REDACTED:empty]" : `[REDACTED:${createHash("sha256").update(str).digest("hex").slice(0, 12)}]`;
  }
}

export interface DbSnapshotOptions {
  /** Which tables to snapshot (default: every base table in `schema`). */
  tables?: string[];
  schema?: string;
  /** Max rows read per table (default: 1000) -- a safety cap, not a sampling strategy; this reads the first `rowLimit` rows in whatever order Postgres returns them. */
  rowLimit?: number;
  /** "table.column" pairs to anonymize even though the name heuristic didn't flag them. */
  includeColumns?: Set<string>;
  /** "table.column" pairs to leave alone even though the name heuristic flagged them -- the escape hatch for a real false positive. */
  excludeColumns?: Set<string>;
}

export interface DbSnapshotTableResult {
  table: string;
  rowCount: number;
  /** Columns that were actually anonymized in this table's output (after includeColumns/excludeColumns are applied) -- not just the ones the heuristic flagged. */
  anonymizedColumns: string[];
  rows: Record<string, unknown>[];
}

/**
 * Connects to a REAL live Postgres database, read-only (`SELECT` only --
 * no writes, no `BEGIN`/transaction needed since nothing here can mutate
 * anything), and returns real rows from real tables with PII-shaped
 * columns deterministically pseudonymized. Intended for turning a
 * snapshot of real production-shaped data into something safe to hand to
 * staging/dev/CI without exposing real customers' emails, names, SSNs,
 * etc. -- while keeping repeated real values consistent with each other
 * in the output (see `anonymizeValue`).
 *
 * Scope, stated plainly: this reads whatever `rowLimit` rows Postgres
 * happens to return first for a table with no explicit ORDER BY -- not a
 * representative sample, and not guaranteed to preserve cross-table
 * referential integrity if a foreign-keyed row falls outside another
 * table's own row limit (e.g. `orders.user_id` referencing a `users.id`
 * that wasn't among the first 1000 user rows read). For a small
 * database this rarely matters; for a large one, raise `--row-limit` or
 * snapshot the referenced tables without a limit.
 */
export async function snapshotDatabase(databaseUrl: string, options: DbSnapshotOptions = {}): Promise<DbSnapshotTableResult[]> {
  const client = await connectPg(databaseUrl);
  try {
    const schema = options.schema ?? "public";
    const tables = options.tables ?? (await listTables(client, schema));
    const rowLimit = options.rowLimit ?? 1000;
    const results: DbSnapshotTableResult[] = [];

    for (const table of tables) {
      const columns = await listColumns(client, table, schema);
      // Table/schema names here come from information_schema itself (or
      // an explicit --tables flag the tool's own user controls) -- not
      // parameterizable as SQL identifiers via $n placeholders (Postgres
      // doesn't support that), so quoted directly instead, with embedded
      // quotes escaped defensively.
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      const queryResult = await client.query(`SELECT * FROM ${quotedTable} LIMIT ${rowLimit}`);

      const anonymizedColumns: string[] = [];
      const rows = queryResult.rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const column of columns) {
          const key = `${table}.${column}`;
          const autoDetected = classifyColumn(column);
          const excluded = options.excludeColumns?.has(key) ?? false;
          const forced = options.includeColumns?.has(key) ?? false;
          const shouldAnonymize = !excluded && (forced || autoDetected !== null);

          if (shouldAnonymize) {
            if (!anonymizedColumns.includes(column)) anonymizedColumns.push(column);
            out[column] = anonymizeValue(autoDetected ?? "generic_secret", row[column]);
          } else {
            out[column] = row[column];
          }
        }
        return out;
      });

      results.push({ table, rowCount: rows.length, anonymizedColumns, rows });
    }

    return results;
  } finally {
    await client.end();
  }
}
