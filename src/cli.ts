#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generate, generateRecords } from "./generator.js";
import { serialize, type OutputFormat } from "./output/index.js";
import { parsePrismaSchema } from "./introspect/prisma.js";
import { parseDrizzleSchema } from "./introspect/drizzle.js";
import { parseSqlAlchemySchema } from "./introspect/sqlalchemy.js";
import { buildSchemaMapping, type SchemaMapping } from "./introspect/mapper.js";
import { mergeOverrides } from "./config.js";
import { SCENARIOS, resolveScenario } from "./scenarios.js";
import type { EcoFakerConfig, Locale } from "./types.js";

const TOOL_VERSION = "0.1.0";

interface Snapshot {
  meta: { tool: "my-eco-gen"; toolVersion: string; createdAt: string; description?: string };
  referenceNow: number;
  config: Partial<EcoFakerConfig>;
}

const program = new Command();

program
  .name("my-eco-gen")
  .description("Generate a stateful, relationally-consistent fake e-commerce dataset.")
  .version(TOOL_VERSION);

program
  .command("generate")
  .description("Generate users, carts, abandoned checkouts, orders, shipments, and returns.")
  .option("-u, --users <number>", "number of core users to generate (scaleFactor)", parseIntArg)
  .option("-f, --format <format>", "output format: json | sql | csv", "json")
  .option("-o, --output <path>", "output file path", "./eco-data.json")
  .option("-s, --seed <number>", "deterministic PRNG seed", parseIntArg)
  .option("-l, --locale <locale>", "locale (en-US, en-GB, es-ES, de-DE, fr-FR, vi-VN)")
  .option("--historical-days <number>", "span of history to generate, in days", parseIntArg)
  .option("--abandonment-rate <number>", "0..1 chance a cart is abandoned", parseFloatArg)
  .option("--return-rate <number>", "0..1 chance a delivered order gets a return", parseFloatArg)
  .option("--delay-probability <number>", "0..1 chance a shipment is delayed", parseFloatArg)
  .option("--max-delay-days <number>", "max extra days added when delayed", parseIntArg)
  .option("--no-anomalies", "disable anomaly injection entirely")
  .option("--bot-cart-rate <number>", "0..1 chance of a bot-activity cart anomaly", parseFloatArg)
  .option("--remote-shipping-rate <number>", "0..1 chance of a remote-region shipping surcharge anomaly", parseFloatArg)
  .option(
    "--contradictory-return-rate <number>",
    "0..1 chance of a negative-reason return with a contradictory CSAT score",
    parseFloatArg
  )
  .option(
    "--scenario <name>",
    `apply a named business-scenario preset (${Object.keys(SCENARIOS).join(" | ")}) before other flags`
  )
  .option("--stream", "stream NDJSON records to stdout as they're produced, instead of writing a file")
  .option("--snapshot <path>", "also save the exact seed/config/referenceNow recipe to a .snapshot.json for later replay")
  .option("--mapping <path>", "apply a mapping.json (from `my-eco-gen init`) to target an existing DB schema's column names")
  .action(async (opts) => {
    const explicitOverrides = buildOverridesFromGenerateOpts(opts);
    let scenarioOverrides: Partial<EcoFakerConfig> | undefined;
    if (opts.scenario) {
      try {
        scenarioOverrides = resolveScenario(opts.scenario);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    }
    const overrides = mergeOverrides(scenarioOverrides, explicitOverrides);
    const referenceNow = Date.now();

    if (opts.snapshot) {
      const snapshot: Snapshot = {
        meta: {
          tool: "my-eco-gen",
          toolVersion: TOOL_VERSION,
          createdAt: new Date(referenceNow).toISOString(),
          description: opts.scenario ? `scenario: ${opts.scenario}` : undefined,
        },
        referenceNow,
        config: overrides,
      };
      const snapshotPath = path.resolve(process.cwd(), opts.snapshot);
      mkdirSync(path.dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
      console.error(`Snapshot recipe saved to ${snapshotPath} (seed=${overrides.seed ?? "default"})`);
    }

    if (opts.stream) {
      await streamToStdout(overrides, referenceNow);
      return;
    }

    const format = opts.format as OutputFormat;
    if (!["json", "sql", "csv"].includes(format)) {
      console.error(`Unsupported format "${opts.format}". Use json, sql, or csv.`);
      process.exit(1);
    }

    const start = performance.now();
    const dataset = generate(overrides, referenceNow);
    const mapping: SchemaMapping | undefined = opts.mapping
      ? (JSON.parse(readFileSync(path.resolve(process.cwd(), opts.mapping), "utf-8")) as SchemaMapping)
      : undefined;
    const serialized = serialize(dataset, format, mapping);
    const elapsed = (performance.now() - start).toFixed(1);

    const outputPath = path.resolve(process.cwd(), opts.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf-8");

    const anomalyCounts = {
      botCarts: dataset.carts.filter((c) => c.anomaly?.type === "bot_activity").length,
      remoteShippingOrders: dataset.orders.filter((o) => o.anomaly?.type === "remote_surcharge").length,
      contradictoryReturns: dataset.returnRequests.filter((r) => r.anomaly?.type === "contradictory_review").length,
    };

    console.log(`Generated dataset in ${elapsed}ms:`);
    console.log(`  users:               ${dataset.users.length}`);
    console.log(`  carts:               ${dataset.carts.length}`);
    console.log(`  abandonedCheckouts:  ${dataset.abandonedCheckouts.length}`);
    console.log(`  orders:              ${dataset.orders.length}`);
    console.log(`  shipments:           ${dataset.shipments.length}`);
    console.log(`  returnRequests:      ${dataset.returnRequests.length}`);
    console.log(
      `  anomalies:           ${anomalyCounts.botCarts} bot carts, ${anomalyCounts.remoteShippingOrders} remote-shipping, ${anomalyCounts.contradictoryReturns} contradictory returns`
    );
    console.log(`Written to ${outputPath} (${format})`);
  });

program
  .command("replay")
  .description("Regenerate a byte-identical dataset from a .snapshot.json recipe saved by `generate --snapshot`.")
  .requiredOption("-i, --input <path>", "path to the .snapshot.json file")
  .option("-f, --format <format>", "output format: json | sql | csv", "json")
  .option("-o, --output <path>", "output file path", "./eco-data-replay.json")
  .action((opts) => {
    const snapshotPath = path.resolve(process.cwd(), opts.input);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8")) as Snapshot;

    const format = opts.format as OutputFormat;
    if (!["json", "sql", "csv"].includes(format)) {
      console.error(`Unsupported format "${opts.format}". Use json, sql, or csv.`);
      process.exit(1);
    }

    const dataset = generate(snapshot.config, snapshot.referenceNow);
    const serialized = serialize(dataset, format);

    const outputPath = path.resolve(process.cwd(), opts.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf-8");

    console.log(`Replayed snapshot from ${snapshotPath} (recorded ${snapshot.meta.createdAt})`);
    console.log(
      `  seed=${snapshot.config.seed ?? "default"}, referenceNow=${new Date(snapshot.referenceNow).toISOString()}`
    );
    console.log(`  users: ${dataset.users.length}, orders: ${dataset.orders.length}, shipments: ${dataset.shipments.length}`);
    console.log(`Written to ${outputPath} (${format}) -- byte-identical to the original run.`);
  });

program
  .command("init")
  .description(
    "Introspect an existing schema (Prisma, Drizzle, or SQLAlchemy) and auto-generate a mapping.json (canonical column -> your column names)."
  )
  .requiredOption("--schema <path>", "path to a .prisma, Drizzle (.ts/.js), or SQLAlchemy (.py) schema file")
  .option("--schema-type <type>", "prisma | drizzle | sqlalchemy (default: auto-detect from file extension)")
  .option("-o, --output <path>", "where to write the mapping file", "./mapping.json")
  .option("--tables <list>", "comma-separated subset of tables to map (default: all six)")
  .action((opts) => {
    const schemaPath = path.resolve(process.cwd(), opts.schema);
    const schemaSource = readFileSync(schemaPath, "utf-8");
    const schemaType = opts.schemaType ?? detectSchemaType(schemaPath);

    const parsed =
      schemaType === "prisma"
        ? parsePrismaSchema(schemaSource)
        : schemaType === "drizzle"
        ? parseDrizzleSchema(schemaSource)
        : schemaType === "sqlalchemy"
        ? parseSqlAlchemySchema(schemaSource)
        : null;

    if (!parsed) {
      console.error(`Unrecognized --schema-type "${schemaType}". Use prisma, drizzle, or sqlalchemy.`);
      process.exit(1);
      return;
    }

    const modelCount = Object.keys(parsed.models).length;
    if (modelCount === 0) {
      console.error(`No models/tables found in ${opts.schema} (parsed as ${schemaType}) -- is this a valid schema file?`);
      process.exit(1);
    }

    const tables = opts.tables ? (opts.tables as string).split(",").map((t) => t.trim()) : undefined;
    const mapping = buildSchemaMapping(parsed, tables);

    const outputPath = path.resolve(process.cwd(), opts.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(mapping, null, 2), "utf-8");

    console.log(`Parsed ${modelCount} model(s) from ${opts.schema} (${schemaType}).`);
    for (const [table, tableMapping] of Object.entries(mapping)) {
      if (!tableMapping.targetModel) {
        console.log(`  ${table}: no matching model found -- left unmapped (canonical names kept).`);
        continue;
      }
      const columns = Object.values(tableMapping.columns);
      const confident = columns.filter((c) => c.confidence >= 0.4).length;
      console.log(`  ${table} -> ${tableMapping.targetModel}: ${confident}/${columns.length} columns confidently mapped`);
    }
    console.log(`\nReview and edit ${outputPath}, then run:`);
    console.log(`  my-eco-gen generate --mapping ${opts.output} --format sql --output ./seed.sql`);
  });

program
  .command("scenarios")
  .description("List available --scenario presets and their key config values.")
  .action(() => {
    for (const [name, config] of Object.entries(SCENARIOS)) {
      console.log(`${name}`);
      for (const [key, value] of Object.entries(config)) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
      console.log("");
    }
  });

program.parse();

function detectSchemaType(schemaPath: string): "prisma" | "drizzle" | "sqlalchemy" | undefined {
  if (schemaPath.endsWith(".prisma")) return "prisma";
  if (schemaPath.endsWith(".py")) return "sqlalchemy";
  if (schemaPath.endsWith(".ts") || schemaPath.endsWith(".js")) return "drizzle";
  return undefined;
}

function buildOverridesFromGenerateOpts(opts: Record<string, unknown>): Partial<EcoFakerConfig> {
  const overrides: Partial<EcoFakerConfig> = {};
  if (opts.users !== undefined) overrides.scaleFactor = opts.users as number;
  if (opts.seed !== undefined) overrides.seed = opts.seed as number;
  if (opts.locale !== undefined) overrides.locale = opts.locale as Locale;
  if (opts.historicalDays !== undefined) overrides.historicalDays = opts.historicalDays as number;
  if (opts.abandonmentRate !== undefined) overrides.abandonmentRate = opts.abandonmentRate as number;
  if (opts.returnRate !== undefined) overrides.returnRate = opts.returnRate as number;
  if (opts.delayProbability !== undefined) overrides.delayProbability = opts.delayProbability as number;
  if (opts.maxDelayDays !== undefined) overrides.maxDelayDays = opts.maxDelayDays as number;

  const anomalies: Partial<EcoFakerConfig["anomalies"]> = {};
  if (opts.anomalies === false) anomalies.enabled = false;
  if (opts.botCartRate !== undefined) anomalies.botCartRate = opts.botCartRate as number;
  if (opts.remoteShippingRate !== undefined) anomalies.remoteShippingRate = opts.remoteShippingRate as number;
  if (opts.contradictoryReturnRate !== undefined) anomalies.contradictoryReturnRate = opts.contradictoryReturnRate as number;
  if (Object.keys(anomalies).length > 0) {
    overrides.anomalies = anomalies as EcoFakerConfig["anomalies"];
  }

  return overrides;
}

/**
 * High-volume stream mode: emits one NDJSON line per record the instant
 * it's produced, honoring stdout backpressure (awaiting 'drain' when
 * write() reports its buffer is full) rather than buffering the whole
 * dataset in memory first. Suitable for piping directly into
 * `kafka-console-producer`, a bulk-insert script, or a data lake ingester:
 *
 *   my-eco-gen generate --users 100000 --stream | kafka-console-producer ...
 */
async function streamToStdout(overrides: Partial<EcoFakerConfig>, referenceNow: number): Promise<void> {
  let count = 0;
  for (const { table, record } of generateRecords(overrides, referenceNow)) {
    const line = JSON.stringify({ table, ...record }) + "\n";
    const canContinue = process.stdout.write(line);
    if (!canContinue) {
      await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
    }
    count++;
  }
  console.error(`Streamed ${count} records to stdout.`);
}

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`Expected an integer, got "${value}"`);
  return parsed;
}

function parseFloatArg(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) throw new Error(`Expected a number, got "${value}"`);
  return parsed;
}

