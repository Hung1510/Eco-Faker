/**
 * Browser-safe subset of the public API -- deliberately excludes ./serve.js
 * (depends on express, a Node-only HTTP server) and ./diff.js (reads files
 * via node:fs). Everything exported here is pure computation and bundles
 * cleanly for the static web-static/ demo via esbuild.
 */
export { generate, generateRecords, type StreamRecord } from "./generator.js";
export { generateStores, type Store } from "./multi-store.js";
export { resolveConfig, DEFAULT_CONFIG, mergeOverrides } from "./config.js";
export { SCENARIOS, resolveScenario, type ScenarioName } from "./scenarios.js";
export { serialize } from "./output/index.js";
export type { OutputFormat } from "./output/index.js";
export { buildWebhookEvents, replayEvents, type WebhookEvent, type ReplayOptions } from "./webhook.js";
export { parsePrismaSchema, type ParsedSchema } from "./introspect/prisma.js";
export { buildSchemaMapping, matchColumn, CANONICAL_COLUMNS, type SchemaMapping, type ColumnMapping } from "./introspect/mapper.js";
export { CORE_TABLES, type CoreTable } from "./orm-scaffold.js";
export * from "./types.js";
