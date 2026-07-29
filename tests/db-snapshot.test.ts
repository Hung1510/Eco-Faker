import { describe, expect, it } from "vitest";
import { classifyColumn, anonymizeValue, type PiiKind } from "../src/db-snapshot.js";

describe("classifyColumn", () => {
  const cases: [string, PiiKind][] = [
    ["email", "email"],
    ["user_email", "email"],
    ["e_mail", "email"],
    ["ssn", "ssn"],
    ["social_security_number", "ssn"],
    ["credit_card_number", "credit_card"],
    ["cvv", "credit_card"],
    ["phone", "phone"],
    ["phone_number", "phone"],
    ["mobile", "phone"],
    ["ip_address", "ip_address"],
    ["date_of_birth", "date_of_birth"],
    ["dob", "date_of_birth"],
    ["first_name", "first_name"],
    ["given_name", "first_name"],
    ["last_name", "last_name"],
    ["surname", "last_name"],
    ["street_address", "address"],
    ["billing_address", "address"],
    ["name", "full_name"],
    ["full_name", "full_name"],
    ["customer_name", "full_name"],
    ["password", "generic_secret"],
    ["api_key", "generic_secret"],
  ];

  it.each(cases)("classifies %s as %s", (column, expected) => {
    expect(classifyColumn(column)).toBe(expected);
  });

  it("first_name/last_name are classified distinctly, NOT swallowed by the generic full_name pattern", () => {
    // "first_name" contains "name", so if full_name's pattern were checked
    // first it would wrongly match there instead -- this is the specific
    // ordering this module's pattern list depends on.
    expect(classifyColumn("first_name")).toBe("first_name");
    expect(classifyColumn("last_name")).toBe("last_name");
  });

  it("returns null for columns that are real but not PII-shaped by name", () => {
    for (const column of ["id", "created_at", "status", "total", "price", "quantity", "sku", "currency"]) {
      expect(classifyColumn(column), `${column} should not be classified as PII`).toBeNull();
    }
  });

  it("documents a known, real false-positive risk: a literal 'name' column is classified full_name even when it holds a product name, not a person's -- this is why --exclude-anonymize exists", () => {
    // Confirmed against a real live Postgres products.name column during
    // this feature's own development: it got anonymized into a fake
    // PERSON's name ("Sean Ankunding") before --exclude-anonymize was
    // used to override it. This test documents the behavior is expected
    // (a name heuristic, not column-content inspection), not a bug to fix.
    expect(classifyColumn("name")).toBe("full_name");
  });
});

describe("anonymizeValue", () => {
  it("is deterministic: the same real value always produces the same fake replacement", () => {
    const a = anonymizeValue("email", "alice@realcompany.com");
    const b = anonymizeValue("email", "alice@realcompany.com");
    expect(a).toBe(b);
  });

  it("different real values produce different fake replacements (not a constant placeholder)", () => {
    const a = anonymizeValue("email", "alice@realcompany.com");
    const b = anonymizeValue("email", "bob@realcompany.com");
    expect(a).not.toBe(b);
  });

  it("null and undefined pass through unchanged -- a missing value isn't PII to fake", () => {
    expect(anonymizeValue("email", null)).toBeNull();
    expect(anonymizeValue("email", undefined)).toBeUndefined();
  });

  it("never returns the original real value for a non-null input", () => {
    const realValues: [PiiKind, string][] = [
      ["email", "real.person@company.com"],
      ["first_name", "Alexandria"],
      ["last_name", "Nakamura"],
      ["ssn", "123-45-6789"],
      ["phone", "555-201-3344"],
      ["address", "742 Evergreen Terrace"],
      ["credit_card", "4111111111111111"],
      ["ip_address", "192.168.1.1"],
      ["date_of_birth", "1990-04-12"],
    ];
    for (const [kind, real] of realValues) {
      expect(anonymizeValue(kind, real), `${kind} should not pass real value through unchanged`).not.toBe(real);
    }
  });

  it("email replacements are real, plausible email addresses (contain @ and a domain), never the literal redaction marker", () => {
    const result = anonymizeValue("email", "someone@realcompany.com") as string;
    expect(result).toContain("@");
    expect(result).not.toContain("[REDACTED");
  });

  it("generic_secret replacements are an opaque redaction marker, never a plausible-looking fake credential", () => {
    // A real password hash should never be replaced with something that
    // LOOKS like a valid credential -- that's actively more dangerous
    // than an obviously-fake marker if anyone mistakes the output for real.
    const result = anonymizeValue("generic_secret", "hunter2") as string;
    expect(result).toMatch(/^\[REDACTED:/);
  });

  it("generic_secret is still deterministic and distinguishes different real secrets", () => {
    const a = anonymizeValue("generic_secret", "hunter2");
    const b = anonymizeValue("generic_secret", "hunter2");
    const c = anonymizeValue("generic_secret", "different-secret");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("ssn replacements match a real SSN-shaped pattern (NNN-NN-NNNN), never the original", () => {
    const result = anonymizeValue("ssn", "123-45-6789") as string;
    expect(result).toMatch(/^\d{3}-\d{2}-\d{4}$/);
    expect(result).not.toBe("123-45-6789");
  });

  it("date_of_birth replacements are valid ISO dates, not the original", () => {
    const result = anonymizeValue("date_of_birth", "1990-04-12") as string;
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).not.toBe("1990-04-12");
  });
});
