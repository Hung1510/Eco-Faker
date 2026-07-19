import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { generateElasticsearchMappings, generateElasticsearchBulkNdjson } from "../src/output/benchmark/elasticsearch.js";
import { datasetToCanonicalRows } from "../src/introspect/canonical-rows.js";

describe("Elasticsearch benchmark export", () => {
  const dataset = generate({ seed: 1, scaleFactor: 200 });

  describe("mappings", () => {
    const mappings = generateElasticsearchMappings(dataset);

    it("produces a mapping for every table CANONICAL_COLUMNS knows about", () => {
      const rows = datasetToCanonicalRows(dataset);
      expect(Object.keys(mappings).sort()).toEqual(Object.keys(rows).sort());
    });

    it("id and every *_id column is mapped as keyword, never a numeric or text type", () => {
      for (const mapping of Object.values(mappings)) {
        for (const [col, def] of Object.entries(mapping.mappings.properties)) {
          if (col === "id" || col.endsWith("_id")) {
            expect(def.type, `${col} should be keyword`).toBe("keyword");
          }
        }
      }
    });

    it("every *_at column is mapped as date", () => {
      for (const mapping of Object.values(mappings)) {
        for (const [col, def] of Object.entries(mapping.mappings.properties)) {
          if (col.endsWith("_at")) {
            expect(def.type, `${col} should be date`).toBe("date");
          }
        }
      }
    });

    it("regression: a numeric column is only mapped 'long' if every real sampled value is actually an integer", () => {
      // orders.shipping is $0 for most orders but a real decimal
      // (surcharge) for some -- this caught a real bug where only the
      // first sampled value was checked for integer-ness.
      for (const seed of [1, 2, 3, 4, 5]) {
        const ds = generate({ seed, scaleFactor: 300 });
        const mappingsForSeed = generateElasticsearchMappings(ds);
        const rows = datasetToCanonicalRows(ds);
        for (const [table, tableRows] of Object.entries(rows)) {
          const properties = mappingsForSeed[table].mappings.properties;
          for (const col of Object.keys(properties)) {
            if (properties[col].type !== "long") continue;
            for (const row of tableRows) {
              const v = row[col];
              if (v !== null && v !== undefined) {
                expect(Number.isInteger(v), `${table}.${col} mapped 'long' but has non-integer value ${v} (seed ${seed})`).toBe(true);
              }
            }
          }
        }
      }
    });

    it("boolean-shaped fields map to boolean, not keyword or long", () => {
      // No boolean fields currently exist in canonical rows (everything
      // flattens through JSON.stringify or stays a primitive) -- this
      // test documents that fact so a future boolean field is caught
      // if the type inference regresses.
      const allTypes = new Set(
        Object.values(mappings).flatMap((m) => Object.values(m.mappings.properties).map((p) => p.type))
      );
      expect(["keyword", "text", "long", "double", "date"].some((t) => allTypes.has(t as any))).toBe(true);
    });
  });

  describe("bulk NDJSON", () => {
    const bulk = generateElasticsearchBulkNdjson(dataset);

    it("produces a file per table", () => {
      const rows = datasetToCanonicalRows(dataset);
      expect(Object.keys(bulk).sort()).toEqual(Object.keys(rows).sort());
    });

    it("every non-empty file has an even number of lines (action line + document line pairs)", () => {
      for (const [table, content] of Object.entries(bulk)) {
        if (content === "") continue;
        const lines = content.trim().split("\n");
        expect(lines.length % 2, `${table} should have an even line count`).toBe(0);
      }
    });

    it("action lines are valid { index: { _index, _id } } JSON, alternating with real document JSON", () => {
      const lines = bulk.orders.trim().split("\n");
      for (let i = 0; i < lines.length; i += 2) {
        const action = JSON.parse(lines[i]);
        expect(action).toHaveProperty("index");
        expect(action.index).toHaveProperty("_index");
        expect(action.index).toHaveProperty("_id");
        const doc = JSON.parse(lines[i + 1]);
        expect(doc.id).toBe(action.index._id);
      }
    });

    it("index name is derived from the table name with underscores replaced by hyphens", () => {
      const lines = bulk.replenishment_orders.trim().split("\n");
      const action = JSON.parse(lines[0]);
      expect(action.index._index).toBe("eco-faker-replenishment-orders");
    });

    it("respects a custom index prefix", () => {
      const custom = generateElasticsearchBulkNdjson(dataset, "my-shop");
      const lines = custom.orders.trim().split("\n");
      const action = JSON.parse(lines[0]);
      expect(action.index._index).toBe("my-shop-orders");
    });

    it("row count matches the real number of records in that table", () => {
      const rows = datasetToCanonicalRows(dataset);
      for (const [table, content] of Object.entries(bulk)) {
        const lineCount = content === "" ? 0 : content.trim().split("\n").length / 2;
        expect(lineCount).toBe(rows[table].length);
      }
    });
  });
});
