import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { buildOpenApiSpec } from "../src/openapi.js";
import { parseOpenApiSchema } from "../src/introspect/openapi.js";
import { buildSchemaMapping } from "../src/introspect/mapper.js";

describe("parseOpenApiSchema", () => {
  it("extracts model names and property names from components.schemas (OpenAPI 3.x)", () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      components: {
        schemas: {
          User: { type: "object", properties: { id: {}, firstName: {}, lastName: {}, email: {} } },
          Order: { type: "object", properties: { id: {}, userId: {}, total: {}, createdAt: {} } },
        },
      },
    });
    const parsed = parseOpenApiSchema(spec);
    expect(Object.keys(parsed.models).sort()).toEqual(["Order", "User"]);
    expect(parsed.models.User.sort()).toEqual(["email", "firstName", "id", "lastName"]);
  });

  it("falls back to Swagger 2.0's `definitions` when components.schemas is absent", () => {
    const spec = JSON.stringify({
      swagger: "2.0",
      definitions: {
        Product: { type: "object", properties: { sku: {}, name: {}, price: {} } },
      },
    });
    const parsed = parseOpenApiSchema(spec);
    expect(parsed.models.Product.sort()).toEqual(["name", "price", "sku"]);
  });

  it("merges one level of allOf sub-schema properties", () => {
    const spec = JSON.stringify({
      components: {
        schemas: {
          ExtendedOrder: {
            allOf: [{ properties: { id: {}, total: {} } }, { properties: { status: {} } }],
          },
        },
      },
    });
    const parsed = parseOpenApiSchema(spec);
    expect(parsed.models.ExtendedOrder.sort()).toEqual(["id", "status", "total"]);
  });

  it("throws a clear error on invalid JSON instead of an opaque parse error", () => {
    expect(() => parseOpenApiSchema("not json at all")).toThrow(/Could not parse OpenAPI spec as JSON/);
  });

  it("returns an empty models map (not a crash) for a spec with no schemas", () => {
    const parsed = parseOpenApiSchema(JSON.stringify({ openapi: "3.0.0", paths: {} }));
    expect(parsed.models).toEqual({});
  });
});

describe("OpenAPI schema inference dogfood test -- eco-faker's own spec, self-mapped", () => {
  it("mapping eco-faker's own /openapi.json back onto its own canonical tables produces high-confidence matches", () => {
    const dataset = generate({ seed: 1, scaleFactor: 20 });
    const spec = buildOpenApiSpec(dataset, 4000);
    const parsed = parseOpenApiSchema(JSON.stringify(spec));

    // eco-faker's own spec should have real schemas to extract.
    expect(Object.keys(parsed.models).length).toBeGreaterThan(0);

    const mapping = buildSchemaMapping(parsed);

    // Every canonical table should find *some* matching schema in its own
    // spec -- if this fails, either buildOpenApiSpec's schema names drifted
    // from CANONICAL_COLUMNS's table names, or the OpenAPI parser broke.
    const unmapped = Object.entries(mapping).filter(([, m]) => m.targetModel === null);
    expect(unmapped, `tables with no matching model: ${unmapped.map(([t]) => t).join(", ")}`).toEqual([]);

    // And most columns on the matched models should be confident matches
    // (a dataset mapped onto its own spec is about as easy as this gets).
    for (const [table, tableMapping] of Object.entries(mapping)) {
      const columns = Object.values(tableMapping.columns);
      const confident = columns.filter((c) => c.confidence >= 0.4).length;
      expect(confident / columns.length, `${table}: too few confident column matches`).toBeGreaterThan(0.5);
    }
  });
});
