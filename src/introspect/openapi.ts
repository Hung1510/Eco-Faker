import type { ParsedSchema } from "./prisma.js";

interface JsonSchemaLike {
  properties?: Record<string, unknown>;
  allOf?: JsonSchemaLike[];
  [key: string]: unknown;
}

function collectProperties(schema: JsonSchemaLike): string[] {
  const props = new Set<string>();
  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) props.add(key);
  }
  // One level of allOf merging -- common for inheritance-style OpenAPI specs
  // (`allOf: [{ $ref: '#/components/schemas/Base' }, { properties: {...} }]`).
  // Deliberately not recursive/$ref-resolving beyond that: this is a
  // best-effort field-name extractor for column-mapping purposes, not a
  // full JSON Schema resolver.
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      if (sub.properties) for (const key of Object.keys(sub.properties)) props.add(key);
    }
  }
  return [...props];
}

/**
 * Turns a live (or locally saved) OpenAPI spec into the same `ParsedSchema`
 * shape (`{ models: Record<modelName, fieldNames[]> }`) the Prisma/Drizzle/
 * SQLAlchemy parsers produce -- so it plugs directly into the existing
 * `buildSchemaMapping` engine with no changes there. Supports OpenAPI 3.x
 * (`components.schemas`) and Swagger 2.0 (`definitions`) JSON documents.
 * YAML specs aren't supported -- convert to JSON first (most OpenAPI
 * tooling, including eco-faker's own `serve --openapi`, publishes JSON).
 */
export function parseOpenApiSchema(source: string): ParsedSchema {
  let spec: Record<string, unknown>;
  try {
    spec = JSON.parse(source);
  } catch (err) {
    throw new Error(`Could not parse OpenAPI spec as JSON: ${(err as Error).message}`);
  }

  const schemas =
    ((spec.components as Record<string, unknown> | undefined)?.schemas as Record<string, JsonSchemaLike> | undefined) ??
    (spec.definitions as Record<string, JsonSchemaLike> | undefined) ??
    {};

  const models: Record<string, string[]> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    models[name] = collectProperties(schema);
  }

  return { models };
}

/**
 * Fetches an OpenAPI spec from a live URL (e.g. `https://api.example.com/openapi.json`,
 * or eco-faker's own `serve`'s `/openapi.json`) and parses it the same way
 * as a locally saved file. Kept as a separate function from the CLI's file
 * I/O so it's independently testable without a network call.
 */
export async function fetchAndParseOpenApiSchema(url: string): Promise<ParsedSchema> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec from ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  const source = await response.text();
  return parseOpenApiSchema(source);
}
