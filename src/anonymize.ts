import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Faker, en } from "@faker-js/faker";

/**
 * What kind of PII a column *looks like it holds*, purely from its name.
 * This is a heuristic, stated plainly as one -- a column literally named
 * `name` holding a product name, not a person's, would be a real false
 * positive (confirmed against real data -- see `db-snapshot.ts`'s
 * ROADMAP entry). `excludeColumns` exists specifically to override an
 * auto-detection that's wrong for a given schema; `includeColumns`
 * exists to catch a real PII column this heuristic misses.
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

export interface AnonymizeRowsOptions {
  /** "table.column" pairs to anonymize even though the name heuristic didn't flag them. */
  includeColumns?: Set<string>;
  /** "table.column" pairs to leave alone even though the name heuristic flagged them -- the escape hatch for a real false positive. */
  excludeColumns?: Set<string>;
}

export interface AnonymizeRowsResult {
  rows: Record<string, unknown>[];
  /** Columns that were actually anonymized (after includeColumns/excludeColumns are applied) -- not just the ones the heuristic flagged. */
  anonymizedColumns: string[];
}

/**
 * The one real place row-level anonymization decisions get made --
 * `db-snapshot.ts`'s live-Postgres path and the file-based `anonymize`
 * command both call this directly rather than each re-deciding which
 * columns to anonymize on their own, which is exactly the kind of logic
 * duplication this project avoids elsewhere (see `CANONICAL_COLUMNS`,
 * `mergeOverrides`, etc.).
 */
/**
 * A real bug, caught by anonymizing an actual generated dataset rather
 * than assumed safe from the name-pattern alone: `recoveryEmailSent` (a
 * boolean) and `recoveryEmailSentAt` (an ISO timestamp string) both
 * matched `classifyColumn`'s `/e[-_]?mail/i` pattern (the substring
 * "email" appears in both names) and got corrupted into fake email
 * strings -- a boolean replaced with a string is a type corruption, not
 * just a semantic near-miss like the earlier `products.name` case.
 *
 * This checks the REAL sample values for a column classifyColumn
 * auto-detected (never applied to a user-forced `includeColumns` pick --
 * if someone explicitly says to anonymize a column, that's respected
 * regardless of its shape) and rejects the classification if the values
 * don't plausibly fit: a boolean is never any PII kind; an "email"
 * classification specifically requires the real values look like email
 * addresses (contain "@"), which also catches the ISO-timestamp case
 * above (a date string has no "@").
 */
function looksPlausibleForKind(kind: PiiKind, sampleValues: unknown[]): boolean {
  const nonNull = sampleValues.filter((v) => v !== null && v !== undefined).slice(0, 20);
  if (nonNull.length === 0) return true; // nothing real to check against -- don't block on an all-null sample
  if (nonNull.some((v) => typeof v === "boolean")) return false; // no PII kind is ever legitimately a boolean
  if (kind === "email") return nonNull.every((v) => typeof v === "string") && nonNull.some((v) => (v as string).includes("@"));
  return true;
}

export function anonymizeRows(tableName: string, rows: Record<string, unknown>[], options: AnonymizeRowsOptions = {}): AnonymizeRowsResult {
  if (rows.length === 0) return { rows: [], anonymizedColumns: [] };
  const columns = Object.keys(rows[0]);
  const anonymizedColumns: string[] = [];

  // Classify once per column (not per row) -- looksPlausibleForKind needs
  // to look across the real values in the column, which only needs doing
  // once, not on every row iteration.
  const columnClassifications = new Map<string, PiiKind | null>();
  for (const column of columns) {
    const rawAutoDetected = classifyColumn(column);
    columnClassifications.set(
      column,
      rawAutoDetected && looksPlausibleForKind(rawAutoDetected, rows.map((r) => r[column])) ? rawAutoDetected : null
    );
  }

  const outRows = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const column of columns) {
      const key = `${tableName}.${column}`;
      const autoDetected = columnClassifications.get(column) ?? null;
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

  return { rows: outRows, anonymizedColumns };
}

/**
 * A minimal, real CSV parser -- RFC 4180-shaped (quoted fields, `""` as
 * an escaped quote inside a quoted field, commas/newlines allowed inside
 * quotes), not a naive `line.split(",")` that would silently corrupt any
 * real export containing a quoted field with a comma in it (an address,
 * a product description). No external CSV-parsing dependency: this
 * project has none, and the format's real quoting rules are small enough
 * to implement directly and test thoroughly rather than take on a new
 * dependency for.
 *
 * Scope, confirmed directly while building this rather than assumed: this
 * expects standards-compliant quoting -- a field containing a comma or
 * quote must be wrapped in quotes from its very first character
 * (`"a, b"`, not `a", b"` or a bare `"` appearing mid-unquoted-field).
 * Malformed input violating that produces silently lossy output (a real
 * failure mode confirmed against a deliberately malformed fixture during
 * development) rather than an error -- most real CSV writers (Excel,
 * Postgres `\copy`, any real CSV library) never produce the malformed
 * shape in the first place, so this is a reasonable line to draw for a
 * first slice rather than building a fully lenient/recovering parser.
 */
export function parseCsv(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue; // normalize CRLF -> LF by simply dropping the \r; the following \n (if any) ends the row below
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      i++;
      continue;
    }
    field += char;
    i++;
  }
  // Final field/row if the file doesn't end with a trailing newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmptyRows.length === 0) return [];
  const header = nonEmptyRows[0];
  return nonEmptyRows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    for (let col = 0; col < header.length; col++) {
      record[header[col]] = cells[col] ?? "";
    }
    return record;
  });
}

export interface LoadedTables {
  [tableName: string]: Record<string, unknown>[];
}

/**
 * Loads a local export into a generic `{ tableName: rows }` shape,
 * accepting three real, common cases -- deliberately not tied to
 * eco-faker's own `Dataset` type, since the whole point of this loader
 * is anonymizing REAL external data someone already exported, not
 * something this tool generated:
 *
 * - a `.csv` file: always a single table, named from `--table` if given,
 *   else the filename without its extension.
 * - a `.json` file containing a flat array `[{...}, {...}]`: same
 *   single-table naming rule as CSV.
 * - a `.json` file containing an object whose values are arrays
 *   (`{ users: [...], orders: [...] }`, the same shape a real
 *   `dataset.json` or a `db-snapshot` output directory's files have):
 *   every array-valued key becomes its own table, non-array keys
 *   (a `config` block, say) are silently not tables -- not fabricated
 *   into empty ones.
 */
export function loadTablesFromFile(filePath: string, explicitTableName?: string): LoadedTables {
  const ext = path.extname(filePath).toLowerCase();
  const defaultTableName = explicitTableName ?? path.basename(filePath, path.extname(filePath));

  if (ext === ".csv") {
    return { [defaultTableName]: parseCsv(readFileSync(filePath, "utf-8")) };
  }

  if (ext === ".json") {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    if (Array.isArray(parsed)) {
      return { [defaultTableName]: parsed as Record<string, unknown>[] };
    }
    if (parsed && typeof parsed === "object") {
      const tables: LoadedTables = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(value)) tables[key] = value as Record<string, unknown>[];
      }
      return tables;
    }
    throw new Error(`${filePath} is valid JSON but neither an array of rows nor an object of table-name -> rows.`);
  }

  throw new Error(`${filePath}: unrecognized extension "${ext}" -- expected .json or .csv.`);
}
