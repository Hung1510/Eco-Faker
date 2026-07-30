import { anonymizeRows, classifyColumn, anonymizeValue, type PiiKind, type AnonymizeRowsOptions } from "./anonymize.js";

// Re-exported for backward compatibility -- these used to be defined
// directly in this file; they're now shared with the file-based
// `anonymize` command via anonymize.ts, so this file only re-exports
// them rather than duplicating the implementation.
export { classifyColumn, anonymizeValue, type PiiKind };

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

export interface DbSnapshotOptions extends AnonymizeRowsOptions {
  /** Which tables to snapshot (default: every base table in `schema`). */
  tables?: string[];
  schema?: string;
  /** Max rows read per table (default: 1000) -- a safety cap, not a sampling strategy; this reads the first `rowLimit` rows in whatever order Postgres returns them. */
  rowLimit?: number;
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
 * columns deterministically pseudonymized via `anonymizeRows` (shared
 * with the file-based `anonymize` command in `anonymize.ts` -- the actual
 * anonymization decision-making lives there, once, not duplicated here).
 * Intended for turning a snapshot of real production-shaped data into
 * something safe to hand to staging/dev/CI without exposing real
 * customers' emails, names, SSNs, etc. -- while keeping repeated real
 * values consistent with each other in the output.
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
      // Table/schema names here come from information_schema itself (or
      // an explicit --tables flag the tool's own user controls) -- not
      // parameterizable as SQL identifiers via $n placeholders (Postgres
      // doesn't support that), so quoted directly instead, with embedded
      // quotes escaped defensively.
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      const queryResult = await client.query(`SELECT * FROM ${quotedTable} LIMIT ${rowLimit}`);

      const { rows, anonymizedColumns } = anonymizeRows(table, queryResult.rows, {
        includeColumns: options.includeColumns,
        excludeColumns: options.excludeColumns,
      });

      results.push({ table, rowCount: rows.length, anonymizedColumns, rows });
    }

    return results;
  } finally {
    await client.end();
  }
}
