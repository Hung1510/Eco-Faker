import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyColumn, anonymizeValue, anonymizeRows, parseCsv, loadTablesFromFile, type PiiKind } from "../src/anonymize.js";

describe("classifyColumn", () => {
  it("classifies real, common PII-shaped column names correctly", () => {
    const cases: [string, PiiKind][] = [
      ["email", "email"],
      ["user_email", "email"],
      ["first_name", "first_name"],
      ["last_name", "last_name"],
      ["ssn", "ssn"],
      ["phone_number", "phone"],
      ["street_address", "address"],
      ["password", "generic_secret"],
    ];
    for (const [column, expected] of cases) {
      expect(classifyColumn(column)).toBe(expected);
    }
  });

  it("returns null for non-PII columns", () => {
    for (const column of ["id", "status", "total", "created_at", "sku"]) {
      expect(classifyColumn(column)).toBeNull();
    }
  });
});

describe("anonymizeValue", () => {
  it("is deterministic and never returns the real input", () => {
    const a = anonymizeValue("email", "real@company.com");
    const b = anonymizeValue("email", "real@company.com");
    expect(a).toBe(b);
    expect(a).not.toBe("real@company.com");
  });

  it("passes null/undefined through unchanged", () => {
    expect(anonymizeValue("email", null)).toBeNull();
    expect(anonymizeValue("email", undefined)).toBeUndefined();
  });
});

describe("anonymizeRows -- regression: a name-pattern match that doesn't fit the real data is rejected, not corrupted", () => {
  it("a boolean column matching an email-ish name pattern is left alone, not corrupted into a fake email string", () => {
    // Real bug, caught against a real generated dataset: 'recoveryEmailSent'
    // (a boolean) matched classifyColumn's /email/ pattern and got replaced
    // with a fake email string -- a boolean becoming a string is a type
    // corruption, not just a semantic near-miss.
    const rows = [
      { id: "1", recoveryEmailSent: true, recoveryEmailSentAt: "2026-01-01T00:00:00Z" },
      { id: "2", recoveryEmailSent: false, recoveryEmailSentAt: "2026-01-02T00:00:00Z" },
    ];
    const { rows: result, anonymizedColumns } = anonymizeRows("abandonedCheckouts", rows);
    expect(anonymizedColumns).not.toContain("recoveryEmailSent");
    expect(result[0].recoveryEmailSent).toBe(true);
    expect(result[1].recoveryEmailSent).toBe(false);
  });

  it("a string column matching an email-ish name pattern, but whose real values don't look like emails (no @), is left alone", () => {
    // 'recoveryEmailSentAt' is a string (an ISO timestamp), so the
    // boolean check alone wouldn't catch it -- the "@"-shape check does.
    const rows = [{ id: "1", recoveryEmailSentAt: "2026-01-01T00:00:00Z" }];
    const { rows: result, anonymizedColumns } = anonymizeRows("abandonedCheckouts", rows);
    expect(anonymizedColumns).not.toContain("recoveryEmailSentAt");
    expect(result[0].recoveryEmailSentAt).toBe("2026-01-01T00:00:00Z");
  });

  it("a real email column (real @-containing values) is still correctly anonymized -- the plausibility check doesn't over-correct", () => {
    const rows = [{ id: "1", email: "alice@realcompany.com" }, { id: "2", email: "bob@realcompany.com" }];
    const { rows: result, anonymizedColumns } = anonymizeRows("users", rows);
    expect(anonymizedColumns).toContain("email");
    expect(result[0].email).not.toBe("alice@realcompany.com");
    expect(String(result[0].email)).toContain("@");
  });

  it("--anonymize (forced include) is respected even when the value shape wouldn't otherwise pass the plausibility check", () => {
    // An explicit user override should win regardless of value shape --
    // they know their own schema better than a generic heuristic does.
    const rows = [{ id: "1", weirdBooleanEmailFlag: true }];
    const { rows: result, anonymizedColumns } = anonymizeRows("t", rows, { includeColumns: new Set(["t.weirdBooleanEmailFlag"]) });
    expect(anonymizedColumns).toContain("weirdBooleanEmailFlag");
    // Forced with no real classification match falls back to generic_secret redaction.
    expect(String(result[0].weirdBooleanEmailFlag)).toMatch(/^\[REDACTED:/);
  });

  it("--exclude-anonymize always wins over auto-detection, the documented escape hatch for a real false positive", () => {
    const rows = [{ id: "1", name: "Wireless Mouse" }, { id: "2", name: "Mechanical Keyboard" }];
    const { rows: result, anonymizedColumns } = anonymizeRows("products", rows, { excludeColumns: new Set(["products.name"]) });
    expect(anonymizedColumns).not.toContain("name");
    expect(result[0].name).toBe("Wireless Mouse");
  });

  it("returns empty output for an empty row set, without throwing", () => {
    expect(anonymizeRows("t", [])).toEqual({ rows: [], anonymizedColumns: [] });
  });
});

describe("parseCsv", () => {
  it("parses a simple, valid CSV into real row objects", () => {
    const rows = parseCsv("id,name\n1,Alice\n2,Bob\n");
    expect(rows).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
  });

  it("correctly handles a real comma inside a properly-quoted field", () => {
    const rows = parseCsv('id,address\n1,"742 Evergreen Terrace, Apt 5"\n');
    expect(rows[0].address).toBe("742 Evergreen Terrace, Apt 5");
  });

  it("correctly handles an escaped double-quote inside a properly-quoted field", () => {
    const rows = parseCsv('id,notes\n1,"Called about a ""refund, please"""\n');
    expect(rows[0].notes).toBe('Called about a "refund, please"');
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsv("id,name\r\n1,Alice\r\n2,Bob\r\n");
    expect(rows).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
  });

  it("handles a file with no trailing newline", () => {
    const rows = parseCsv("id,name\n1,Alice");
    expect(rows).toEqual([{ id: "1", name: "Alice" }]);
  });

  it("returns an empty array for an empty/header-only input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("id,name\n")).toEqual([]);
  });

  it("documented scope limitation: a bare quote appearing mid-unquoted-field (invalid RFC4180) is lossy, not an error -- confirmed directly, not just assumed", () => {
    // This is deliberately testing (and documenting) the known limitation,
    // not asserting it's "correct" -- real CSV writers never produce this
    // malformed shape (a field must be quoted from its first character if
    // it contains a quote or comma at all).
    const malformed = parseCsv('id,notes\n1,Called about a ""refund, please""\n');
    expect(malformed[0].notes).not.toBe('Called about a "refund, please"'); // lossy, as documented
  });
});

describe("loadTablesFromFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "eco-anonymize-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a .csv file as a single table named from the filename", () => {
    const p = path.join(dir, "customers.csv");
    writeFileSync(p, "id,email\n1,alice@example.com\n", "utf-8");
    const tables = loadTablesFromFile(p);
    expect(Object.keys(tables)).toEqual(["customers"]);
    expect(tables.customers).toEqual([{ id: "1", email: "alice@example.com" }]);
  });

  it("loads a .csv file with an explicit --table override name", () => {
    const p = path.join(dir, "export.csv");
    writeFileSync(p, "id\n1\n", "utf-8");
    const tables = loadTablesFromFile(p, "users");
    expect(Object.keys(tables)).toEqual(["users"]);
  });

  it("loads a flat JSON array as a single table named from the filename", () => {
    const p = path.join(dir, "orders.json");
    writeFileSync(p, JSON.stringify([{ id: "o1" }, { id: "o2" }]), "utf-8");
    const tables = loadTablesFromFile(p);
    expect(Object.keys(tables)).toEqual(["orders"]);
    expect(tables.orders).toHaveLength(2);
  });

  it("loads a multi-table JSON object (real dataset.json shape), one entry per array-valued key", () => {
    const p = path.join(dir, "dataset.json");
    writeFileSync(p, JSON.stringify({ users: [{ id: "u1" }], orders: [{ id: "o1" }], config: { seed: 1 } }), "utf-8");
    const tables = loadTablesFromFile(p);
    expect(Object.keys(tables).sort()).toEqual(["orders", "users"]); // config (not an array) is correctly excluded
  });

  it("throws a clear error for a JSON file that's neither an array nor an object of arrays", () => {
    const p = path.join(dir, "bad.json");
    writeFileSync(p, JSON.stringify("just a string"), "utf-8");
    expect(() => loadTablesFromFile(p)).toThrow(/neither an array of rows nor an object/);
  });

  it("throws a clear error for an unrecognized file extension", () => {
    const p = path.join(dir, "data.txt");
    writeFileSync(p, "hello", "utf-8");
    expect(() => loadTablesFromFile(p)).toThrow(/unrecognized extension/);
  });
});
