#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { generate, generateRecords } from "./generator.js";
import { buildOpenApiSpec } from "./openapi.js";
import { runContractTest, type OpenApiDocument } from "./contract-test.js";
import { runMutationTest, buildSeedBodiesFromDataset } from "./mutation-test.js";
import { runScenarioTest, validateScenario, type Scenario } from "./scenario-test.js";
import { buildScaffold, SCAFFOLD_TARGETS, SIMPLE_SCAFFOLD_TARGETS, ORM_SCAFFOLD_TARGETS, type ScaffoldTarget } from "./scaffold.js";
import { buildPrismaSeedScript, buildDrizzleSeedScript, buildSqlAlchemySeedScript } from "./orm-scaffold.js";
import { computeRealismScore } from "./score.js";
import { SUPPORTED_LOCALES } from "./locales.js";
import { generateCompletion, SUPPORTED_SHELLS, type Shell, type CompletionCommandInfo } from "./completion.js";
import { parseReadmeHeadings, resolveDocsTopic, buildDocsUrl } from "./docs.js";
import { generateWithTargetFunnel } from "./funnel-target.js";
import { generateStores } from "./multi-store.js";
import { createMockApiServer } from "./serve.js";
import { buildPostmanCollection } from "./postman.js";
import { attachLiveFeed } from "./live.js";
import { buildWebhookEvents, replayEvents } from "./webhook.js";
import { buildMailReplayItems, replayMail, startMailServer } from "./mail.js";
import { diffDatasets, formatDiffReport, loadDatasetLike } from "./diff.js";
import { serialize, type OutputFormat } from "./output/index.js";
import { parsePrismaSchema } from "./introspect/prisma.js";
import { parseDrizzleSchema } from "./introspect/drizzle.js";
import { parseSqlAlchemySchema } from "./introspect/sqlalchemy.js";
import { parseOpenApiSchema, fetchAndParseOpenApiSchema } from "./introspect/openapi.js";
import { buildSchemaMapping, type SchemaMapping } from "./introspect/mapper.js";
import { mergeOverrides, resolveConfig } from "./config.js";
import { SCENARIOS, resolveScenario } from "./scenarios.js";
import { applySemanticFuzzing, summarizeMutations, type FuzzMutationType } from "./fuzz.js";
import { lintDataset, lintSqlAgainstDatabase } from "./lint.js";
import { buildUserJourney, pickRichestUserId, renderJourneyHtml } from "./visualize.js";
import { applyFraudSimulation, summarizeFraudSignals, type FraudType } from "./fraud.js";
import { computeAnalytics } from "./analytics.js";
import { analyticsToCsvFiles, analyticsToSql } from "./output/dashboard.js";
import { generateElasticsearchMappings, generateElasticsearchBulkNdjson } from "./output/benchmark/elasticsearch.js";
import { generateClickHouseDdl } from "./output/benchmark/clickhouse.js";
import { generateAiDataset } from "./output/ai-dataset.js";
import { buildEventStream } from "./events.js";
import { composeScenarioFile, type ScenarioFileLoader } from "./scenario-composer.js";
import { Faker, en } from "@faker-js/faker";
import { generateWithTemporalProfile, TEMPORAL_PROFILES, type TemporalProfile } from "./temporal.js";
import { generateOtelExport } from "./otel.js";
import { load as loadYaml } from "js-yaml";
import { main as runMcpServer } from "./mcp.js";
import type { EcoFakerConfig, Locale } from "./types.js";

const TOOL_VERSION = "0.2.1";

interface Snapshot {
  meta: { tool: "my-eco-gen"; toolVersion: string; createdAt: string; description?: string };
  referenceNow: number;
  config: Partial<EcoFakerConfig>;
}

const program = new Command();

// One level up from this file (src/cli.ts when run via tsx, dist/cli.js
// when run from a real install) is the package root -- where README.md
// and package.json actually live, per package.json's own "files" list.
// Resolved this way so `docs`/`completion` find the real files whether
// running from a source checkout or an installed package, instead of a
// path guess that only works in one of the two.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

program
  .name("my-eco-gen")
  .description("Generate a stateful, relationally-consistent fake e-commerce dataset.")
  .version(TOOL_VERSION);

/** Options shared by every command that ultimately calls generate()/generateRecords(). */
function addCoreGenerateOptions(cmd: Command): Command {
  return cmd
    .option("-u, --users <number>", "number of core users to generate (scaleFactor)", parseIntArg)
    .option("-s, --seed <number>", "deterministic PRNG seed", parseIntArg)
    .option("-l, --locale <locale>", "locale for names/addresses/currency (e.g. en-US, ja, pt-BR, ar) -- any real @faker-js/faker locale code; run `my-eco-gen locales` to list them all")
    .option("--historical-days <number>", "span of history to generate, in days", parseIntArg)
    .option("--abandonment-rate <number>", "0..1 chance a cart is abandoned", parseFloatArg)
    .option("--return-rate <number>", "0..1 chance a delivered order gets a return", parseFloatArg)
    .option("--delay-probability <number>", "0..1 chance a shipment is delayed", parseFloatArg)
    .option("--max-delay-days <number>", "max extra days added when delayed", parseIntArg)
    .option("--no-anomalies", "disable anomaly injection entirely")
    .option("--no-recommendation-data", "disable product views/search queries/wishlist/ratings generation")
    .option("--no-inventory-simulation", "disable warehouses/replenishment orders/stockouts/transfers generation")
    .option("--no-support-tickets", "disable support ticket + threaded message generation")
    .option("--no-email-messages", "disable transactional email generation")
    .option("--bot-cart-rate <number>", "0..1 chance of a bot-activity cart anomaly", parseFloatArg)
    .option("--remote-shipping-rate <number>", "0..1 chance of a remote-region shipping surcharge anomaly", parseFloatArg)
    .option(
      "--contradictory-return-rate <number>",
      "0..1 chance of a negative-reason return with a contradictory CSAT score",
      parseFloatArg
    )
    .option("--catalog-size <number>", "how many products to generate in the shared catalog (default: 150)", parseIntArg)
    .option(
      "--scenario <name>",
      `apply a named business-scenario preset (${Object.keys(SCENARIOS).join(" | ")}) before other flags`
    )
    .option(
      "--scenario-file <path>",
      "apply a user-authored scenario YAML/JSON file (inherits: [...] + overrides: {...}) -- see README's \"Scenario composer\" section. Applied before --scenario and explicit flags, both of which still take precedence."
    );
}

/** Resolve scenario + explicit CLI flags into a single overrides object, exiting on an unknown scenario name. */
/**
 * The real filesystem-backed loader for `composeScenarioFile` -- YAML
 * (.yaml/.yml) or JSON, resolved relative to the referencing file's own
 * directory so a scenario file's `inherits` paths stay portable
 * regardless of the working directory the CLI was invoked from.
 */
const fsScenarioLoader: ScenarioFileLoader = {
  resolvePath(ref, fromFilePath) {
    if (ref in SCENARIOS) return null;
    return path.isAbsolute(ref) ? ref : path.resolve(path.dirname(fromFilePath), ref);
  },
  read(filePath) {
    const raw = readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath).toLowerCase();
    return (ext === ".json" ? JSON.parse(raw) : loadYaml(raw)) as ReturnType<ScenarioFileLoader["read"]>;
  },
};

function resolveOverrides(opts: Record<string, unknown>): Partial<EcoFakerConfig> {
  const explicitOverrides = buildOverridesFromGenerateOpts(opts);
  let scenarioFileOverrides: Partial<EcoFakerConfig> | undefined;
  if (opts.scenarioFile) {
    try {
      const composed = composeScenarioFile(path.resolve(process.cwd(), opts.scenarioFile as string), fsScenarioLoader);
      scenarioFileOverrides = composed.config;
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }
  let scenarioOverrides: Partial<EcoFakerConfig> | undefined;
  if (opts.scenario) {
    try {
      scenarioOverrides = resolveScenario(opts.scenario as string);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }
  return mergeOverrides(scenarioFileOverrides, scenarioOverrides, explicitOverrides);
}

/**
 * Shared by `fuzz`, `lint`, and `visualize`: load a dataset from
 * `--input <path>` (any `generate --format json` output) if given,
 * otherwise generate a fresh one from the usual `addCoreGenerateOptions`
 * flags -- same "either load or generate" pattern `diff` and `webhook`
 * already use individually.
 */
function loadOrGenerateDataset(opts: Record<string, unknown>) {
  if (opts.input) {
    return loadDatasetLike(path.resolve(process.cwd(), opts.input as string));
  }
  const overrides = resolveOverrides(opts);
  return generate(overrides, Date.now());
}

addCoreGenerateOptions(
  program
    .command("generate")
    .description("Generate users, carts, abandoned checkouts, orders, shipments, and returns.")
)
  .option("-f, --format <format>", "output format: json | sql | csv", "json")
  .option("-o, --output <path>", "output file path", "./eco-data.json")
  .option("--stores <number>", "generate N independent stores (JSON output only)", parseIntArg)
  .option("--stream", "stream NDJSON records to stdout as they're produced, instead of writing a file")
  .option("--snapshot <path>", "also save the exact seed/config/referenceNow recipe to a .snapshot.json for later replay")
  .option("--mapping <path>", "apply a mapping.json (from `my-eco-gen init`) to target an existing DB schema's column names")
  .option("--fraud-rate <number>", "0..1 chance an order is considered for a fraud tag (default: 0, disabled). See README's Fraud simulation section for the six fraud types.", parseFloatArg)
  .option("--fraud-types <list>", "comma-separated subset of: stolen_card,account_farming,reseller_behavior,refund_abuse,friendly_chargeback,coupon_abuse_ring (default: all six)")
  .option("--fraud-seed <number>", "seed for reproducible fraud-tag selection (default: 1)", parseIntArg, 1)
  .option(
    "--target-funnel-rate <number>",
    "0..1 target view->purchase conversion rate -- calibrates abandonmentRate via search to hit it (see README's Funnel-targeted generation section for what this can and can't control)",
    parseFloatArg
  )
  .option("--target-funnel-tolerance <number>", "acceptable distance from --target-funnel-rate before the search stops (default 0.02)", parseFloatArg)
  .action(async (opts) => {
    const overrides = resolveOverrides(opts);
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

    if (opts.stores !== undefined) {
      if (format !== "json") {
        console.error("--stores is only supported with --format json for now.");
        process.exit(1);
      }
      const stores = generateStores(overrides, referenceNow, opts.stores as number);
      const outputPath = path.resolve(process.cwd(), opts.output);
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(stores, null, 2), "utf-8");
      console.log(`Generated ${stores.length} store(s):`);
      for (const store of stores) {
        console.log(`  ${store.storeId}: ${store.dataset.users.length} users, ${store.dataset.orders.length} orders`);
      }
      console.log(`Written to ${outputPath} (json)`);
      return;
    }

    const start = performance.now();
    let dataset: ReturnType<typeof generate>;
    if (opts.targetFunnelRate !== undefined) {
      console.error(`Calibrating abandonmentRate to hit a ${((opts.targetFunnelRate as number) * 100).toFixed(0)}% view->purchase conversion rate...`);
      const result = generateWithTargetFunnel({
        target: opts.targetFunnelRate as number,
        tolerance: opts.targetFunnelTolerance as number | undefined,
        overrides,
        referenceNow,
      });
      dataset = result.dataset;
      console.error(
        `${result.withinTolerance ? "Hit" : "Closest reachable:"} ${(result.achievedRate * 100).toFixed(1)}% (target ${(result.targetRate * 100).toFixed(1)}%) at abandonmentRate=${result.calibratedAbandonmentRate.toFixed(4)}, ${result.iterations} attempt(s).`
      );
      if (!result.withinTolerance) {
        console.error(
          `  Note: this target wasn't reachable within tolerance by calibrating abandonmentRate alone at this scale/seed -- using the closest result found.`
        );
      }
    } else {
      dataset = generate(overrides, referenceNow);
    }
    let fraudSummary: Record<FraudType, number> | undefined;
    if (opts.fraudRate) {
      const fraudTypes = opts.fraudTypes
        ? ((opts.fraudTypes as string).split(",").map((s) => s.trim()) as FraudType[])
        : undefined;
      const fraudResult = applyFraudSimulation(dataset, {
        fraudRate: opts.fraudRate as number,
        types: fraudTypes,
        seed: opts.fraudSeed as number,
      });
      dataset = fraudResult.dataset;
      fraudSummary = summarizeFraudSignals(fraudResult.signals);
    }
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
    console.log(
      `  catalog:             ${dataset.categories.length} categories, ${dataset.brands.length} brands, ${dataset.suppliers.length} suppliers, ${dataset.products.length} products`
    );
    console.log(`  users:               ${dataset.users.length}`);
    console.log(`  carts:               ${dataset.carts.length}`);
    console.log(`  abandonedCheckouts:  ${dataset.abandonedCheckouts.length}`);
    console.log(`  orders:              ${dataset.orders.length}`);
    console.log(`  shipments:           ${dataset.shipments.length}`);
    console.log(`  returnRequests:      ${dataset.returnRequests.length}`);
    if (dataset.config.recommendationData.enabled) {
      console.log(
        `  recommendationData:  ${dataset.productViews.length} views, ${dataset.searchQueries.length} searches, ${dataset.wishlistItems.length} wishlisted, ${dataset.productRatings.length} ratings`
      );
    }
    if (dataset.config.inventorySimulation.enabled) {
      console.log(
        `  inventorySimulation: ${dataset.warehouses.length} warehouses, ${dataset.replenishmentOrders.length} replenishments, ${dataset.stockoutPeriods.length} stockouts, ${dataset.warehouseTransfers.length} transfers`
      );
    }
    if (dataset.config.supportTickets.enabled) {
      console.log(
        `  supportTickets:      ${dataset.supportTickets.length} tickets, ${dataset.supportMessages.length} messages`
      );
    }
    if (dataset.config.emailMessages.enabled) {
      console.log(`  emailMessages:       ${dataset.emailMessages.length} emails`);
    }
    console.log(
      `  anomalies:           ${anomalyCounts.botCarts} bot carts, ${anomalyCounts.remoteShippingOrders} remote-shipping, ${anomalyCounts.contradictoryReturns} contradictory returns`
    );
    if (fraudSummary) {
      const total = Object.values(fraudSummary).reduce((a, b) => a + b, 0);
      const breakdown = Object.entries(fraudSummary)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${count} ${type}`)
        .join(", ");
      console.log(`  fraud:               ${total} order(s) flagged${breakdown ? ` (${breakdown})` : ""} (JSON output only, not in SQL/CSV)`);
    }
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
  .command("warp")
  .description(
    "Replay a .snapshot.json recipe as if it had been generated --days earlier/later -- same seed, same config, every timestamp shifted by exactly that many days. For regression-testing time-relative logic (SLA/overdue windows, cart abandonment timeouts, ...) against a fixed, reproducible scenario at a different point in wall-clock time."
  )
  .requiredOption("--snapshot <path>", "path to a .snapshot.json recipe (from `generate --snapshot`)")
  .requiredOption("--days <number>", "days to shift forward (+) or backward (-) from the snapshot's original referenceNow", parseFloatArg)
  .option("-f, --format <format>", "output format: json | sql | csv", "json")
  .option("-o, --output <path>", "output file path", "./eco-data-warped.json")
  .option(
    "--diff",
    "also print a structural diff (row counts, schema fields, status distributions) between the original and warped datasets -- see README's Time-travel regression section for what this can and can't catch"
  )
  .action((opts) => {
    const snapshotPath = path.resolve(process.cwd(), opts.snapshot);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8")) as Snapshot;

    const format = opts.format as OutputFormat;
    if (!["json", "sql", "csv"].includes(format)) {
      console.error(`Unsupported format "${opts.format}". Use json, sql, or csv.`);
      process.exit(1);
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const days = opts.days as number;
    const warpedReferenceNow = snapshot.referenceNow + days * dayMs;

    const warped = generate(snapshot.config, warpedReferenceNow);
    const serialized = serialize(warped, format);

    const outputPath = path.resolve(process.cwd(), opts.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf-8");

    console.log(`Warped snapshot from ${snapshotPath} (recorded ${snapshot.meta.createdAt}) by ${days > 0 ? "+" : ""}${days} day(s).`);
    console.log(`  original referenceNow=${new Date(snapshot.referenceNow).toISOString()}`);
    console.log(`  warped   referenceNow=${new Date(warpedReferenceNow).toISOString()}`);
    console.log(`  users: ${warped.users.length}, orders: ${warped.orders.length}, shipments: ${warped.shipments.length}`);
    console.log(`Written to ${outputPath} (${format})`);

    if (opts.diff) {
      const original = generate(snapshot.config, snapshot.referenceNow);
      const report = diffDatasets(original, warped);
      console.log(`\n${formatDiffReport(report, "original", "warped")}`);
    }
  });

program
  .command("init")
  .description(
    "Either scaffolds a fresh project integration (`init next`/`init msw`/`init prisma`/`init drizzle`/`init sqlalchemy`, writes real files) or just maps eco-faker's output onto a schema you already have (`init --schema <path>` alone, no target). See README's 'Framework scaffolding' section."
  )
  .argument("[target]", `scaffold target: ${SCAFFOLD_TARGETS.join(" | ")} -- writes new files wiring generated data into a fresh project. ${ORM_SCAFFOLD_TARGETS.join("/")} need --schema <path>; ${SIMPLE_SCAFFOLD_TARGETS.join("/")} don't. Omit the target entirely and use --schema alone to just produce a reviewable mapping.json without any seed script.`)
  .option(
    "--schema <path-or-url>",
    "path to a .prisma, Drizzle (.ts/.js), or SQLAlchemy (.py) schema file -- or, with --schema-type openapi, a local .json file or a live http(s):// URL (e.g. your own API's /openapi.json). Required for the prisma/drizzle/sqlalchemy scaffold targets; also valid on its own (no target) for mapping-only mode."
  )
  .option("--schema-type <type>", "prisma | drizzle | sqlalchemy | openapi (default: auto-detect from file extension; ignored for the prisma/drizzle/sqlalchemy scaffold targets, which already know their own type)")
  .option("-o, --output <path>", "where to write the mapping file (mapping-only mode only)", "./mapping.json")
  .option("--tables <list>", "comma-separated subset of tables to map (mapping-only mode only)")
  .option("--seed <number>", "seed baked into the scaffold's generated seed script (scaffold mode only, default: 1)", parseIntArg)
  .option("--force", "overwrite existing files at the scaffold's target paths (scaffold mode only)")
  .action(async (target: string | undefined, opts) => {
    if (target && (SIMPLE_SCAFFOLD_TARGETS as readonly string[]).includes(target) && opts.schema) {
      console.error(
        `"${target}" doesn't take --schema -- there's no schema to introspect for it. Did you mean one of ${ORM_SCAFFOLD_TARGETS.join("/")} (which do), or to drop --schema and just run "init ${target}"?`
      );
      process.exit(1);
      return;
    }

    if (target && !(SCAFFOLD_TARGETS as readonly string[]).includes(target)) {
      console.error(`Unknown scaffold target "${target}". Supported: ${SCAFFOLD_TARGETS.join(", ")}.`);
      process.exit(1);
      return;
    }

    if (target && (ORM_SCAFFOLD_TARGETS as readonly string[]).includes(target)) {
      if (!opts.schema) {
        console.error(`"init ${target}" needs a schema to introspect -- e.g. my-eco-gen init ${target} --schema ./schema.${target === "prisma" ? "prisma" : target === "drizzle" ? "ts" : "py"}`);
        process.exit(1);
        return;
      }

      const schemaPath = path.resolve(process.cwd(), opts.schema as string);
      let parsed: { models: Record<string, string[]> };
      try {
        const schemaSource = readFileSync(schemaPath, "utf-8");
        parsed =
          target === "prisma" ? parsePrismaSchema(schemaSource) : target === "drizzle" ? parseDrizzleSchema(schemaSource) : parseSqlAlchemySchema(schemaSource);
      } catch (err) {
        console.error(`Couldn't read/parse ${schemaPath}: ${(err as Error).message}`);
        process.exit(1);
        return;
      }

      const modelCount = Object.keys(parsed.models).length;
      if (modelCount === 0) {
        console.error(`No models found in ${schemaPath} (parsed as ${target}) -- is this a valid schema?`);
        process.exit(1);
        return;
      }

      const mapping = buildSchemaMapping(parsed);
      const seed = (opts.seed as number | undefined) ?? 1;
      const ormResult =
        target === "prisma" ? buildPrismaSeedScript(mapping, seed) : target === "drizzle" ? buildDrizzleSeedScript(mapping, seed) : buildSqlAlchemySeedScript(mapping, seed);

      const mappingOutputPath = path.resolve(process.cwd(), opts.output as string);
      const allFiles = [...ormResult.files, { path: path.relative(process.cwd(), mappingOutputPath), contents: JSON.stringify(mapping, null, 2) }];

      const conflicts = allFiles.filter((file) => existsSync(path.resolve(process.cwd(), file.path)));
      if (conflicts.length > 0 && !opts.force) {
        console.error(`Already exist (pass --force to overwrite):\n${conflicts.map((f) => `  ${f.path}`).join("\n")}`);
        process.exit(1);
        return;
      }

      for (const file of allFiles) {
        const outputPath = path.resolve(process.cwd(), file.path);
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, file.contents, "utf-8");
        console.log(`Wrote ${file.path}`);
      }

      console.log(`\nParsed ${modelCount} model(s) from ${schemaPath} (${target}).`);
      if (ormResult.skippedTables.length > 0) {
        console.log(`No confident model match for: ${ormResult.skippedTables.join(", ")} -- skipped in the generated seed script (not guessed at).`);
      }
      console.log("");
      for (const step of ormResult.nextSteps) console.log(step);
      return;
    }

    if (target) {
      const result = buildScaffold(target as ScaffoldTarget, { seed: opts.seed as number | undefined });

      const conflicts = result.files.filter((file) => existsSync(path.resolve(process.cwd(), file.path)));
      if (conflicts.length > 0 && !opts.force) {
        console.error(`Already exist (pass --force to overwrite):\n${conflicts.map((f) => `  ${f.path}`).join("\n")}`);
        process.exit(1);
        return;
      }

      for (const file of result.files) {
        const outputPath = path.resolve(process.cwd(), file.path);
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, file.contents, "utf-8");
        console.log(`Wrote ${file.path}`);
      }
      console.log("");
      for (const step of result.nextSteps) console.log(step);
      return;
    }

    if (!opts.schema) {
      console.error(
        `Run either:\n  my-eco-gen init ${SCAFFOLD_TARGETS.join(" | init ")}   -- scaffold a fresh project integration\n  my-eco-gen init --schema <path>   -- just map onto an existing Prisma/Drizzle/SQLAlchemy/OpenAPI schema, no seed script`
      );
      process.exit(1);
      return;
    }

    const isUrl = /^https?:\/\//.test(opts.schema);
    const schemaType = opts.schemaType ?? (isUrl ? "openapi" : detectSchemaType(opts.schema));

    let parsed: { models: Record<string, string[]> } | null = null;
    try {
      if (schemaType === "openapi" && isUrl) {
        parsed = await fetchAndParseOpenApiSchema(opts.schema);
      } else if (schemaType === "openapi") {
        const source = readFileSync(path.resolve(process.cwd(), opts.schema), "utf-8");
        parsed = parseOpenApiSchema(source);
      } else if (!isUrl) {
        const schemaPath = path.resolve(process.cwd(), opts.schema);
        const schemaSource = readFileSync(schemaPath, "utf-8");
        parsed =
          schemaType === "prisma"
            ? parsePrismaSchema(schemaSource)
            : schemaType === "drizzle"
            ? parseDrizzleSchema(schemaSource)
            : schemaType === "sqlalchemy"
            ? parseSqlAlchemySchema(schemaSource)
            : null;
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
      return;
    }

    if (!parsed) {
      console.error(
        isUrl
          ? `A URL was given for --schema but --schema-type is "${schemaType}", not "openapi" -- only OpenAPI specs can be fetched from a URL.`
          : `Unrecognized --schema-type "${schemaType}". Use prisma, drizzle, sqlalchemy, or openapi.`
      );
      process.exit(1);
      return;
    }

    const modelCount = Object.keys(parsed.models).length;
    if (modelCount === 0) {
      console.error(`No models/tables found in ${opts.schema} (parsed as ${schemaType}) -- is this a valid schema?`);
      process.exit(1);
    }

    const tables = opts.tables ? (opts.tables as string).split(",").map((t) => t.trim()) : undefined;
    const mapping = buildSchemaMapping(parsed, tables);

    const outputPath = path.resolve(process.cwd(), opts.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(mapping, null, 2), "utf-8");

    console.log(`Parsed ${modelCount} model(s)/schema(s) from ${opts.schema} (${schemaType}).`);
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

program
  .command("locales")
  .description("List every locale --locale/config.locale currently accepts.")
  .action(() => {
    console.log(`${SUPPORTED_LOCALES.length} supported locales (derived from the installed @faker-js/faker):\n`);
    console.log(SUPPORTED_LOCALES.join(", "));
  });

addCoreGenerateOptions(
  program
    .command("serve")
    .description(
      "Spin up a mock REST API (json-server style) backed by a generated dataset -- build/demo a frontend against a realistic backend."
    )
)
  .option("-p, --port <number>", "port to listen on", parseIntArg, 4000)
  .option("--chaos", "inject random latency spikes, 500s, and 429s into every /api/* response")
  .option("--chaos-latency-rate <number>", "0..1 chance of injected latency (with --chaos)", parseFloatArg)
  .option("--chaos-error-rate <number>", "0..1 chance of a simulated 500 (with --chaos)", parseFloatArg)
  .option("--chaos-rate-limit-rate <number>", "0..1 chance of a simulated 429 (with --chaos)", parseFloatArg)
  .option("--api-key <key>", "require `Authorization: Bearer <key>` on every /api/* request")
  .option("--no-openapi", "don't serve GET /openapi.json")
  .option("--postman", "serve GET /postman.json and write a .postman_collection.json file to disk at startup")
  .option("--graphql", "mount POST /graphql, executing queries against the same dataset via the GraphQL adapter (requires the optional 'graphql' package)")
  .option("--postman-output <path>", "where to write the Postman collection file", "./eco-faker.postman_collection.json")
  .option("--live", "also open a WebSocket at /live broadcasting a steady drip of dataset events")
  .option("--live-interval-ms <number>", "ms between live broadcasts", parseIntArg, 800)
  .option("--quiet", "suppress the per-request console log line (meaning header is still sent)")
  .action((opts) => {
    const overrides = resolveOverrides(opts);
    const referenceNow = Date.now();

    console.error("Generating dataset...");
    const start = performance.now();
    const dataset = generate(overrides, referenceNow);
    const elapsed = (performance.now() - start).toFixed(1);
    console.error(
      `Ready in ${elapsed}ms: ${dataset.users.length} users, ${dataset.orders.length} orders, ${dataset.shipments.length} shipments, ${dataset.returnRequests.length} returns.`
    );

    const port = opts.port as number;
    const chaos = opts.chaos
      ? {
          ...(opts.chaosLatencyRate !== undefined ? { latencyRate: opts.chaosLatencyRate as number } : {}),
          ...(opts.chaosErrorRate !== undefined ? { errorRate: opts.chaosErrorRate as number } : {}),
          ...(opts.chaosRateLimitRate !== undefined ? { rateLimitRate: opts.chaosRateLimitRate as number } : {}),
        }
      : undefined;

    const app = createMockApiServer(dataset, {
      chaos: chaos && Object.keys(chaos).length > 0 ? chaos : opts.chaos ? true : undefined,
      apiKey: opts.apiKey,
      openapi: opts.openapi !== false,
      postman: Boolean(opts.postman),
      graphql: Boolean(opts.graphql),
      quiet: Boolean(opts.quiet),
      port,
    });

    if (opts.postman) {
      const collection = buildPostmanCollection({ port, apiKey: opts.apiKey });
      const postmanPath = path.resolve(process.cwd(), opts.postmanOutput);
      mkdirSync(path.dirname(postmanPath), { recursive: true });
      writeFileSync(postmanPath, JSON.stringify(collection, null, 2), "utf-8");
      console.error(`Postman collection written to ${postmanPath}`);
    }

    const server = app.listen(port, () => {
      console.log(`Mock API running at http://localhost:${port}`);
      console.log(`  GET http://localhost:${port}/api/orders?status=delivered&page=1&pageSize=25`);
      console.log(`  GET http://localhost:${port}/api/shipments/:id`);
      console.log(`  GET http://localhost:${port}/  (endpoint list + counts)`);
      if (opts.openapi !== false) console.log(`  GET http://localhost:${port}/openapi.json  (import into Postman/Insomnia/Swagger UI)`);
      if (opts.postman) console.log(`  GET http://localhost:${port}/postman.json  (or import ${opts.postmanOutput} directly)`);
      if (opts.chaos) console.log(`  chaos mode ON: latency/500/429 injected into /api/* responses`);
      if (opts.apiKey) console.log(`  auth ON: send "Authorization: Bearer ${opts.apiKey}" or every /api/* request gets a 401`);
      if (opts.live) console.log(`  live feed: ws://localhost:${port}/live`);
      if (!opts.quiet) console.log(`  request log ON: plain-English status meanings printed per request (--quiet to silence)`);
    });

    if (opts.live) {
      attachLiveFeed(server, overrides, referenceNow, { intervalMs: opts.liveIntervalMs as number });
    }
  });

addCoreGenerateOptions(
  program
    .command("openapi-export")
    .description(
      "Write the OpenAPI 3.0 contract serve --openapi would expose to a file, without starting a server -- the natural input to `test --contract`."
    )
)
  .option("-o, --output <path>", "output file path", "./openapi.json")
  .option("--port <number>", "port number to record in the contract's `servers` field (cosmetic only -- doesn't start anything)", parseIntArg, 4000)
  .action((opts) => {
    const overrides = resolveOverrides(opts);
    const dataset = generate(overrides, Date.now());
    const spec = buildOpenApiSpec(dataset, opts.port as number);
    const outputPath = path.resolve(process.cwd(), opts.output as string);
    writeFileSync(outputPath, JSON.stringify(spec, null, 2));
    console.log(`Written to ${outputPath}`);
  });

addCoreGenerateOptions(
  program
    .command("webhook")
    .description(
      "Replay the generated dataset as a paced, chronological stream of webhook events POSTed to a URL (or printed with --dry-run)."
    )
)
  .requiredOption("--url <url>", "URL to POST each event to as JSON (ignored with --dry-run)")
  .option("--speed <number>", "simulated seconds of dataset time per real second (higher = faster)", parseFloatArg, 3600)
  .option("--max-wait-ms <number>", "cap on the real-world wait between any two events, in ms", parseIntArg, 5000)
  .option("--events <list>", "comma-separated event types to emit (default: all)")
  .option("--limit <number>", "stop after N events", parseIntArg)
  .option("--dry-run", "print events instead of POSTing them")
  .action(async (opts) => {
    const overrides = resolveOverrides(opts);
    const referenceNow = Date.now();

    console.error("Building event timeline...");
    const events = buildWebhookEvents(overrides, referenceNow);
    console.error(`${events.length} events spanning the dataset's history. Replaying at ${opts.speed}x speed...`);

    const eventTypes = opts.events ? new Set((opts.events as string).split(",").map((t) => t.trim())) : undefined;

    let posted = 0;
    let failed = 0;
    const total = await replayEvents(
      events,
      { speed: opts.speed as number, maxWaitMs: opts.maxWaitMs as number, eventTypes, limit: opts.limit as number | undefined },
      async (event, index, count) => {
        if (opts.dryRun) {
          console.log(`[${index + 1}/${count}] ${event.timestamp} ${event.type}`);
          return;
        }
        try {
          const res = await fetch(opts.url as string, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
          });
          if (res.ok) posted++;
          else failed++;
          console.error(`[${index + 1}/${count}] ${event.type} -> ${res.status}`);
        } catch (err) {
          failed++;
          console.error(`[${index + 1}/${count}] ${event.type} -> FAILED: ${(err as Error).message}`);
        }
      }
    );

    console.error(
      opts.dryRun
        ? `Dry run complete: ${total} events.`
        : `Done: ${total} events replayed, ${posted} succeeded, ${failed} failed.`
    );
  });

addCoreGenerateOptions(
  program
    .command("mail")
    .description(
      "Start a local MailDev inbox (SMTP + web UI) and replay the generated transactional emails into it, paced like `webhook`."
    )
)
  .option("--smtp-port <number>", "MailDev's incoming SMTP port", parseIntArg, 1025)
  .option("--web-port <number>", "MailDev's web inbox UI port", parseIntArg, 1080)
  .option("--no-open", "don't auto-open the web inbox in a browser")
  .option("--from <address>", "sender address on every outgoing message (eco-faker has no real 'from' concept, so this is a synthetic stand-in)", "orders@eco-faker.test")
  .option("--speed <number>", "simulated seconds of dataset time per real second (higher = faster)", parseFloatArg, 3600)
  .option("--max-wait-ms <number>", "cap on the real-world wait between any two emails, in ms", parseIntArg, 3000)
  .option("--email-types <list>", "comma-separated subset of order_confirmation,shipping_notification,delivery_confirmation,cart_abandonment_recovery,return_confirmation (default: all five)")
  .option("--limit <number>", "stop after N emails", parseIntArg)
  .action(async (opts) => {
    const overrides = resolveOverrides(opts);
    if (overrides.emailMessages?.enabled === false) {
      console.error("`mail` needs transactional emails enabled -- drop --no-email-messages to use this command.");
      process.exit(1);
    }
    const referenceNow = Date.now();

    console.error("Generating dataset...");
    const dataset = generate(overrides, referenceNow);
    const items = buildMailReplayItems(dataset);
    if (items.length === 0) {
      console.error("No email messages in this dataset (0 users, or emailMessages produced nothing) -- nothing to replay.");
      process.exit(1);
    }

    const smtpPort = opts.smtpPort as number;
    const webPort = opts.webPort as number;
    console.error(`Starting MailDev (SMTP :${smtpPort}, web UI :${webPort})...`);
    const server = await startMailServer({ smtpPort, webPort, open: opts.open !== false }).catch((err: Error) => {
      console.error(`Failed to start MailDev: ${err.message}`);
      process.exit(1);
    });
    if (!server) return;

    console.log(`Inbox running at ${server.webUrl}`);
    console.log(`Replaying ${items.length} email(s) at ${opts.speed}x speed, from ${opts.from}...`);

    const emailTypes = opts.emailTypes
      ? new Set((opts.emailTypes as string).split(",").map((t) => `email.${t.trim()}`))
      : undefined;

    let sent = 0;
    let failed = 0;
    process.on("SIGINT", async () => {
      console.error(`\nStopping (${sent} sent, ${failed} failed). Ctrl+C again to force quit.`);
      await server.close();
      process.exit(0);
    });

    const total = await replayMail(
      items,
      {
        smtpPort,
        from: opts.from as string,
        speed: opts.speed as number,
        maxWaitMs: opts.maxWaitMs as number,
        eventTypes: emailTypes,
        limit: opts.limit as number | undefined,
      },
      (item, index, count, error) => {
        if (error) {
          failed++;
          console.error(`[${index + 1}/${count}] ${item.type} -> ${item.to} FAILED: ${error.message}`);
        } else {
          sent++;
          console.error(`[${index + 1}/${count}] ${item.type} -> ${item.to}`);
        }
      }
    );

    console.log(`Done: ${total} email(s) replayed, ${sent} sent, ${failed} failed. Inbox still running at ${server.webUrl} (Ctrl+C to stop).`);
  });

program
  .command("diff")
  .description(
    "Structurally diff two datasets (from `generate --format json`) or snapshot recipes (from `generate --snapshot`): row counts, schema drift, status-distribution shifts."
  )
  .argument("<fileA>", "first dataset.json or snapshot.json")
  .argument("<fileB>", "second dataset.json or snapshot.json")
  .option("--fail-on-schema-change", "exit with code 1 if any table's field set differs between A and B")
  .action((fileA: string, fileB: string, opts) => {
    const a = loadDatasetLike(path.resolve(process.cwd(), fileA));
    const b = loadDatasetLike(path.resolve(process.cwd(), fileB));
    const report = diffDatasets(a, b);

    console.log(formatDiffReport(report, fileA, fileB));

    if (opts.failOnSchemaChange && report.hasSchemaChanges) {
      console.error("\nSchema drift detected -- failing as requested by --fail-on-schema-change.");
      process.exit(1);
    }
  });

addCoreGenerateOptions(
  program
    .command("fuzz")
    .description(
      "Semantic fuzzing: mutate a dataset with data that's schema-valid but logically impossible (mismatched addresses, inverted prices, time-paradox returns, oversell quantities) -- finds business-logic bugs schema validation can't catch."
    )
)
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("--intensity <level>", "low | medium | extreme", "medium")
  .option(
    "--types <list>",
    "comma-separated subset of: address_mismatch,price_inversion,time_paradox,inventory_oversell (default: all four)"
  )
  .option("--fuzz-seed <number>", "seed for reproducible mutation selection", parseIntArg, 1)
  .option("-o, --output <path>", "where to write the mutated dataset", "./eco-data.fuzzed.json")
  .option("--report <path>", "also write the mutation log as JSON to this path")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const types = opts.types
      ? ((opts.types as string).split(",").map((s) => s.trim()) as FuzzMutationType[])
      : undefined;

    const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
      intensity: opts.intensity as "low" | "medium" | "extreme",
      types,
      seed: opts.fuzzSeed as number,
    });

    const outputPath = path.resolve(process.cwd(), opts.output as string);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(mutated, null, 2), "utf-8");

    const summary = summarizeMutations(mutations);
    console.log(`Applied ${mutations.length} semantic mutation(s):`);
    for (const [type, count] of Object.entries(summary)) {
      if (count > 0) console.log(`  ${type}: ${count}`);
    }
    console.log("");
    for (const m of mutations) {
      console.log(`  [${m.type}] ${m.table}/${m.recordId}.${m.field}`);
      console.log(`    ${JSON.stringify(m.before)} -> ${JSON.stringify(m.after)}`);
      console.log(`    ${m.reason}`);
    }
    console.log(`\nMutated dataset written to ${outputPath}`);

    if (opts.report) {
      const reportPath = path.resolve(process.cwd(), opts.report as string);
      writeFileSync(reportPath, JSON.stringify({ mutations, summary }, null, 2), "utf-8");
      console.log(`Mutation report written to ${reportPath}`);
    }

    console.log(
      `\nNote: this mutates data only -- firing these payloads at a live API and asserting on the response is planned for the contract-testing engine ("my-eco-gen test --contract"), which isn't built yet. For now, feed ${path.basename(outputPath)} into your own seed/insert pipeline (or "my-eco-gen lint --input ${path.basename(outputPath)}") and see what breaks.`
    );
  });

addCoreGenerateOptions(
  program
    .command("lint")
    .description(
      "Pre-flight data quality gate: check a dataset for orphaned foreign keys, duplicate ids/emails, and financial/temporal inconsistencies -- entirely offline, no database required."
    )
)
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("--sql <path>", "also dry-run this .sql file against a real Postgres database inside BEGIN/ROLLBACK (requires --db-url and the optional 'pg' package)")
  .option("--db-url <url>", "Postgres connection string for --sql (never committed to -- always rolled back)")
  .action(async (opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const issues = lintDataset(dataset);

    if (issues.length === 0) {
      console.log("ok: no lint issues found (referential integrity, uniqueness, financial/temporal consistency).");
    } else {
      const errors = issues.filter((i) => i.severity === "error");
      const warnings = issues.filter((i) => i.severity === "warning");
      for (const issue of issues) {
        const prefix = issue.severity === "error" ? "error" : "warning";
        const location = issue.recordId ? `${issue.table}/${issue.recordId}` : issue.table;
        console.log(`${prefix}: [${issue.rule}] ${location}: ${issue.message}`);
      }
      console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
    }

    if (opts.sql) {
      if (!opts.dbUrl) {
        console.error("\n--sql requires --db-url.");
        process.exit(1);
      }
      const sql = readFileSync(path.resolve(process.cwd(), opts.sql as string), "utf-8");
      console.log(`\nDry-running ${opts.sql} against ${opts.dbUrl} inside BEGIN/ROLLBACK...`);
      try {
        const result = await lintSqlAgainstDatabase(sql, opts.dbUrl as string);
        if (result.ok) {
          console.log("ok: SQL applied cleanly against the real schema's constraints (then rolled back).");
        } else {
          console.log(`error: the database rejected the SQL: ${result.error}`);
          process.exit(1);
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    }

    if (issues.some((i) => i.severity === "error")) {
      process.exit(1);
    }
  });

program
  .command("score")
  .description(
    "Compute a composite 0-100 realism score across referential integrity, financial/temporal consistency, uniqueness, and order-value distribution shape -- so you can objectively compare two datasets instead of eyeballing them."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("-f, --format <format>", "output format: text | json", "text")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const result = computeRealismScore(dataset);

    if (opts.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Realism score: ${result.overall}/100\n`);
    const nameWidth = Math.max(...result.dimensions.map((d) => d.name.length));
    for (const dim of result.dimensions) {
      console.log(`  ${dim.name.padEnd(nameWidth)}  ${String(dim.score).padStart(3)}/100  (${dim.detail})`);
    }
  });

program
  .command("test")
  .description(
    "Fire real GET requests at a live API and assert status codes + response shapes against an OpenAPI 3.0 contract (see `openapi-export` to produce one). Read-path contract testing -- see README's 'Contract testing' section for exactly what this does and doesn't cover. Add --mutate for the write-path checks (idempotency, race conditions, invalid status transitions, 401/404) -- see the 'Mutation testing' section."
  )
  .requiredOption("--url <url>", "base URL of the live API to test")
  .requiredOption("--contract <path>", "path to an OpenAPI 3.0 contract file (.json or .yaml/.yml)")
  .option(
    "--header <header>",
    "HTTP header to send with every request, as 'Key: Value' (repeatable)",
    (value: string, previous: string[]) => [...previous, value],
    [] as string[]
  )
  .option("--mutate", "also run write-path checks: idempotency, race conditions, invalid status transitions, and 401/404. Fires real POST/PATCH requests against --url -- point this at a disposable/staging environment, not production.")
  .option("--seed <path>", "a dataset.json (from `my-eco-gen generate`) used to build real POST request bodies for --mutate's duplicate_submission/race_condition checks -- see buildSeedBodiesFromDataset")
  .option("--concurrency <number>", "concurrent identical requests fired for the race_condition check (default: 5)", parseIntArg)
  .option("--idempotency-header <name>", "header used to signal request-level idempotency (default: Idempotency-Key)")
  .option(
    "--scenario <path>",
    "path to a YAML/JSON multi-step scenario file -- fires a strict, ordered sequence of real requests (create a cart, check out, ship, attempt an illegal cancel, request a return), threading real ids captured from each response into the next step. See README's 'Scenario testing' section. Combine with --seed to expose a real dataset as {{seed.*}} in the scenario file."
  )
  .action(async (opts) => {
    const contractPath = path.resolve(process.cwd(), opts.contract as string);
    let contract: OpenApiDocument;
    try {
      const raw = readFileSync(contractPath, "utf-8");
      contract = (contractPath.toLowerCase().endsWith(".json") ? JSON.parse(raw) : loadYaml(raw)) as OpenApiDocument;
    } catch (err) {
      console.error(`Couldn't read/parse ${contractPath}: ${(err as Error).message}`);
      process.exit(1);
    }

    const headers: Record<string, string> = {};
    for (const header of opts.header as string[]) {
      const idx = header.indexOf(":");
      if (idx === -1) {
        console.error(`--header "${header}" isn't in 'Key: Value' format.`);
        process.exit(1);
      }
      headers[header.slice(0, idx).trim()] = header.slice(idx + 1).trim();
    }

    console.error(`Testing ${opts.url} against ${contractPath}...`);
    const summary = await runContractTest({ baseUrl: opts.url as string, contract, headers });

    for (const result of summary.results) {
      if (result.ok) {
        console.log(`ok:   GET ${result.path} -> ${result.statusActual}`);
        continue;
      }
      console.log(`FAIL: GET ${result.path}${result.requestUrl ? ` (${result.requestUrl})` : ""}`);
      if (result.error) console.log(`      ${result.error}`);
      if (result.statusActual !== undefined && !result.statusCodesDeclared.includes(String(result.statusActual))) {
        console.log(`      status ${result.statusActual} not declared in contract (declared: ${result.statusCodesDeclared.join(", ")})`);
      }
      for (const schemaError of result.schemaErrors ?? []) {
        console.log(`      ${schemaError}`);
      }
    }

    console.log(`\n${summary.passed} passed, ${summary.failed} failed.`);

    let mutateFailed = 0;
    if (opts.mutate) {
      console.error(`\nRunning write-path (--mutate) checks against ${opts.url}...`);
      let seedBodies: Record<string, Record<string, unknown>> | undefined;
      if (opts.seed) {
        const dataset = loadDatasetLike(path.resolve(process.cwd(), opts.seed as string));
        seedBodies = buildSeedBodiesFromDataset(dataset as unknown as Record<string, unknown>, contract);
      }
      const mutationSummary = await runMutationTest({
        baseUrl: opts.url as string,
        contract,
        headers,
        seedBodies,
        concurrency: opts.concurrency as number | undefined,
        idempotencyHeader: opts.idempotencyHeader as string | undefined,
      });
      mutateFailed = mutationSummary.failed;

      for (const result of mutationSummary.results) {
        const label = `${result.check} ${result.method} ${result.path}`;
        if (result.ok) {
          console.log(`ok:   ${label} -- ${result.detail}`);
          continue;
        }
        console.log(`FAIL: ${label} -- ${result.detail}`);
        if (result.error) console.log(`      ${result.error}`);
      }
      console.log(`\n${mutationSummary.passed} passed, ${mutationSummary.failed} failed (--mutate).`);
      if (!opts.seed) {
        console.log("(no --seed given -- duplicate_submission/race_condition were skipped for every POST path; pass --seed <dataset.json> to run them)");
      }
    }

    let scenarioFailed = 0;
    if (opts.scenario) {
      const scenarioPath = path.resolve(process.cwd(), opts.scenario as string);
      let scenario: Scenario;
      try {
        const raw = readFileSync(scenarioPath, "utf-8");
        scenario = (scenarioPath.toLowerCase().endsWith(".json") ? JSON.parse(raw) : loadYaml(raw)) as Scenario;
      } catch (err) {
        console.error(`Couldn't read/parse ${scenarioPath}: ${(err as Error).message}`);
        process.exit(1);
        return;
      }

      const validationErrors = validateScenario(scenario);
      if (validationErrors.length > 0) {
        console.error(`Invalid scenario file (${scenarioPath}):`);
        for (const e of validationErrors) console.error(`  ${e}`);
        process.exit(1);
        return;
      }

      let seedVariables: Record<string, unknown> | undefined;
      if (opts.seed) {
        seedVariables = loadDatasetLike(path.resolve(process.cwd(), opts.seed as string)) as unknown as Record<string, unknown>;
      }

      console.error(`\nRunning scenario "${scenario.name}" (${scenario.steps.length} steps) against ${opts.url}...`);
      const scenarioResult = await runScenarioTest({ baseUrl: opts.url as string, scenario, headers, seedVariables });
      scenarioFailed = scenarioResult.failed;

      for (const step of scenarioResult.steps) {
        const label = `${step.step} (${step.method} ${step.requestPath})`;
        if (step.ok) {
          console.log(`ok:   ${label} -> ${step.statusActual}`);
          continue;
        }
        console.log(`FAIL: ${label}`);
        if (step.error) console.log(`      ${step.error}`);
        if (step.statusActual !== null && step.statusExpected.length > 0 && !step.statusExpected.includes(step.statusActual)) {
          console.log(`      status ${step.statusActual}, expected one of [${step.statusExpected.join(", ")}]`);
        }
        for (const mismatch of step.bodyMismatches ?? []) console.log(`      ${mismatch}`);
      }
      console.log(
        `\n${scenarioResult.passed} passed, ${scenarioResult.failed} failed (--scenario)${scenarioResult.stoppedEarly ? " -- stopped at first failure, later steps skipped" : ""}.`
      );
      if (!opts.seed && /\{\{\s*seed\./.test(readFileSync(scenarioPath, "utf-8"))) {
        console.log("(this scenario file references {{seed.*}} but no --seed <dataset.json> was given -- those steps will report unresolved placeholders)");
      }
    }

    if (summary.failed > 0 || mutateFailed > 0 || scenarioFailed > 0) process.exit(1);
  });

addCoreGenerateOptions(
  program
    .command("visualize")
    .description(
      "Render one customer's full journey (signup -> cart -> order -> shipments -> returns) as a self-contained, animated HTML timeline (D3, opens directly in a browser)."
    )
)
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("--user <id>", "user id to visualize (default: the user with the richest journey)")
  .option("-o, --output <path>", "output HTML path", "./journey.html")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const userId = (opts.user as string | undefined) ?? pickRichestUserId(dataset);
    const user = dataset.users.find((u) => u.id === userId);
    if (!user) {
      console.error(`No user with id "${userId}" in this dataset.`);
      process.exit(1);
    }

    const events = buildUserJourney(dataset, userId);
    const html = renderJourneyHtml(user, events);

    const outputPath = path.resolve(process.cwd(), opts.output as string);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, html, "utf-8");

    console.log(`${user.firstName} ${user.lastName} (${userId}): ${events.length} events.`);
    console.log(`Journey timeline written to ${outputPath} -- open it directly in a browser.`);
  });

program
  .command("dashboard")
  .description(
    "Compute analytics (daily revenue, conversion funnel, retention cohorts, customer LTV, CAC) from a dataset and export it for a BI tool -- entirely offline, no database or API keys required."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("-f, --format <format>", "output format: csv | sql | json", "csv")
  .option(
    "-o, --output <path>",
    "output path -- a directory for --format csv (one file per table), a single file otherwise (default: ./dashboard/ or ./dashboard.sql / ./dashboard.json)"
  )
  .option(
    "--marketing-spend <number>",
    "assumed total marketing spend for the CAC calculation -- this is the one figure this dataset has nothing else to derive it from, so it's a plain configurable assumption rather than a hidden one (default: 5000)",
    parseFloatArg
  )
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const report = computeAnalytics(dataset, {
      assumedMonthlyMarketingSpend: opts.marketingSpend as number | undefined,
    });
    const format = (opts.format as string) ?? "csv";

    if (format === "csv") {
      const files = analyticsToCsvFiles(report);
      const outputDir = path.resolve(process.cwd(), (opts.output as string) ?? "./dashboard");
      mkdirSync(outputDir, { recursive: true });
      for (const [filename, content] of Object.entries(files)) {
        writeFileSync(path.join(outputDir, filename), content, "utf-8");
      }
      console.log(`Written ${Object.keys(files).length} CSV files to ${outputDir}/`);
      console.log("Import directly: PowerBI (Get Data > Text/CSV), Excel, or Google Sheets.");
    } else if (format === "sql") {
      const sql = analyticsToSql(report);
      const outputPath = path.resolve(process.cwd(), (opts.output as string) ?? "./dashboard.sql");
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, sql, "utf-8");
      console.log(`Written to ${outputPath}`);
      console.log(
        "Load into a real Postgres database, then point Metabase or Superset at it -- neither tool has a native static seed-file format; both build questions/dashboards against a live database connection."
      );
    } else if (format === "json") {
      const outputPath = path.resolve(process.cwd(), (opts.output as string) ?? "./dashboard.json");
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");
      console.log(`Written to ${outputPath}`);
    } else {
      console.error(`Unknown --format "${format}". Use csv, sql, or json.`);
      process.exit(1);
      return;
    }

    console.log(
      `\n${report.ltvSummary.totalCustomers} customers, ${report.ltvSummary.payingCustomers} paying, ` +
        `avg LTV $${report.ltvSummary.averageLTV}, CAC $${report.cac.cac} ` +
        `(assuming $${report.cac.assumedMonthlyMarketingSpend} spend / ${report.cac.newCustomersAcquired} new customers -- override with --marketing-spend).`
    );
  });

program
  .command("benchmark-export")
  .description(
    "Export a dataset for benchmarking Elasticsearch or ClickHouse. Postgres is already covered by `generate --format sql` or `--format csv` + `\\copy`; ClickHouse ingests that same CSV output natively (`FORMAT CSVWithNames`), so this command's ClickHouse target is DDL only, not a second copy of the data in a new format."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .requiredOption("--target <target>", "elasticsearch | clickhouse")
  .option("-o, --output <path>", "output directory (default: ./benchmark-export/)")
  .option("--index-prefix <prefix>", "Elasticsearch index name prefix (default: eco-faker)", "eco-faker")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const outputDir = path.resolve(process.cwd(), (opts.output as string) ?? "./benchmark-export");
    mkdirSync(outputDir, { recursive: true });

    if (opts.target === "elasticsearch") {
      const mappings = generateElasticsearchMappings(dataset);
      const bulk = generateElasticsearchBulkNdjson(dataset, opts.indexPrefix as string);
      let mappingCount = 0;
      let bulkCount = 0;
      for (const [table, mapping] of Object.entries(mappings)) {
        writeFileSync(path.join(outputDir, `${table}.mapping.json`), JSON.stringify(mapping, null, 2), "utf-8");
        mappingCount++;
      }
      for (const [table, content] of Object.entries(bulk)) {
        if (content === "") continue;
        writeFileSync(path.join(outputDir, `${table}.bulk.ndjson`), content, "utf-8");
        bulkCount++;
      }
      console.log(`Written ${mappingCount} index mappings and ${bulkCount} bulk NDJSON files to ${outputDir}/`);
      console.log(
        `Load with, e.g.: curl -s -H "Content-Type: application/json" -XPUT localhost:9200/${opts.indexPrefix}-orders -d @${outputDir}/orders.mapping.json`
      );
      console.log(`Then bulk-index: curl -s -H "Content-Type: application/x-ndjson" -XPOST localhost:9200/_bulk --data-binary @${outputDir}/orders.bulk.ndjson`);
    } else if (opts.target === "clickhouse") {
      const ddl = generateClickHouseDdl(dataset);
      const ddlPath = path.join(outputDir, "schema.sql");
      writeFileSync(ddlPath, ddl, "utf-8");
      console.log(`Written ClickHouse DDL to ${ddlPath}`);
      console.log(
        "Data itself isn't duplicated here -- ClickHouse ingests the existing CSV output natively. Generate it, then load each table:"
      );
      console.log("  my-eco-gen generate --format csv --output ./eco-data.csv");
      console.log('  clickhouse-client --query "INSERT INTO orders FORMAT CSVWithNames" < orders.csv   # (split the combined CSV per table first)');
    } else {
      console.error(`Unknown --target "${opts.target}". Use elasticsearch or clickhouse.`);
      process.exit(1);
      return;
    }
  });

program
  .command("otel-export")
  .description(
    "Export real OTLP/JSON distributed traces from a dataset -- a 'checkout' trace per order (spanning checkout-service and payment-service, sharing one traceId) and a 'fulfill_shipment' trace per shipment (spans exactly matching its real tracking-event timeline). Not built on the OTel Node SDK -- that SDK is for instrumenting live code in real time, not backdating thousands of historical spans -- this constructs the real OTLP/JSON wire format directly."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("--seed <number>", "seed for span/trace IDs and synthetic checkout durations (default: 1)", parseIntArg, 1)
  .option("-o, --output <path>", "output file path", "./traces.json")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const seed = opts.seed as number;
    const faker = new Faker({ locale: [en] });
    faker.seed(seed);
    const result = generateOtelExport(faker, seed, dataset);

    const outputPath = path.resolve(process.cwd(), opts.output as string);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(result.otlp, null, 2), "utf-8");

    console.log(`Written ${result.traceCount} traces (${result.spanCount} spans) to ${outputPath}`);
    console.log("Send it to a real collector, e.g.: curl -X POST http://localhost:4318/v1/traces -H 'Content-Type: application/json' -d @" + outputPath);
  });

program
  .command("ai-export")
  .description(
    "Export a dataset reframed for AI-system testing: Text2SQL question/SQL/groundTruth pairs, a RAG-ready document corpus (support messages, emails, reviews), agent-testing scenarios (tool-call traces using the same query_table tool the MCP server exposes), and an LLM eval set. Every value is a real, directly-computed fact about the dataset -- see README's 'AI dataset export' section for what this does and doesn't cover."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("-o, --output <path>", "output directory (default: ./ai-dataset/)")
  .option("--max-per-user-pairs <number>", "cap on per-user text2sql pairs (default: 20)", parseIntArg)
  .option("--max-scenarios-per-source <number>", "cap on agent scenarios per grounding source (default: 15)", parseIntArg)
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const bundle = generateAiDataset(dataset, {
      maxPerUserPairs: opts.maxPerUserPairs as number | undefined,
      maxScenariosPerSource: opts.maxScenariosPerSource as number | undefined,
    });

    const outputDir = path.resolve(process.cwd(), (opts.output as string) ?? "./ai-dataset");
    mkdirSync(outputDir, { recursive: true });

    const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
    writeFileSync(path.join(outputDir, "text2sql.jsonl"), jsonl(bundle.text2sql), "utf-8");
    writeFileSync(path.join(outputDir, "rag-corpus.jsonl"), jsonl(bundle.ragCorpus), "utf-8");
    writeFileSync(path.join(outputDir, "agent-scenarios.jsonl"), jsonl(bundle.agentScenarios), "utf-8");
    writeFileSync(path.join(outputDir, "eval-set.jsonl"), jsonl(bundle.evalSet), "utf-8");

    console.log(`Written to ${outputDir}/:`);
    console.log(`  text2sql.jsonl        (${bundle.text2sql.length} pairs)`);
    console.log(`  rag-corpus.jsonl      (${bundle.ragCorpus.length} documents)`);
    console.log(`  agent-scenarios.jsonl (${bundle.agentScenarios.length} scenarios)`);
    console.log(`  eval-set.jsonl        (${bundle.evalSet.length} items)`);
  });

program
  .command("events")
  .description(
    "Build a comprehensive, chronologically-ordered event stream from a dataset -- user.created, cart.item_added, order.created, shipment.delivered, product.viewed, replenishment.received, and more, across all 18 tables. Every event carries aggregateId/aggregateType for real event-sourcing replay, not just a flat webhook-style list (see the `webhook` command for real-time-paced delivery to a URL instead)."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("-f, --format <format>", "output format: ndjson | json", "ndjson")
  .option("-o, --output <path>", "output file path (default: ./events.ndjson or ./events.json)")
  .option("--event-types <list>", "comma-separated event types to include (default: all)")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    let events = buildEventStream(dataset);

    if (opts.eventTypes) {
      const wanted = new Set((opts.eventTypes as string).split(",").map((t) => t.trim()));
      events = events.filter((e) => wanted.has(e.type));
    }

    const format = (opts.format as string) ?? "ndjson";
    const outputPath = path.resolve(
      process.cwd(),
      (opts.output as string) ?? (format === "json" ? "./events.json" : "./events.ndjson")
    );
    mkdirSync(path.dirname(outputPath), { recursive: true });

    if (format === "ndjson") {
      writeFileSync(outputPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    } else if (format === "json") {
      writeFileSync(outputPath, JSON.stringify(events, null, 2), "utf-8");
    } else {
      console.error(`Unknown --format "${format}". Use ndjson or json.`);
      process.exit(1);
      return;
    }

    const byType = new Map<string, number>();
    for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    console.log(`Written ${events.length} events (${byType.size} event types) to ${outputPath}`);
  });

const scenarioCommand = program.command("scenario").description("Author and debug scenario files (see --scenario-file on `generate`).");

scenarioCommand
  .command("resolve <file>")
  .description(
    "Resolve a scenario file's full inherits chain into its final merged config and print it as JSON, without generating a dataset -- for authoring and debugging scenario files."
  )
  .action((file: string) => {
    try {
      const { config, chain } = composeScenarioFile(path.resolve(process.cwd(), file), fsScenarioLoader);
      // Also validate the composed config the same way `generate()` would,
      // so authoring mistakes (a value out of the schema's valid range,
      // for instance) surface here instead of only when someone tries to
      // actually generate a dataset from it.
      resolveConfig(config);
      console.log(`Resolved chain: ${chain.join(" -> ")}\n`);
      console.log(JSON.stringify(config, null, 2));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("temporal")
  .description(
    `Generate a dataset whose config varies over calendar time within a single call -- a quiet baseline, then a demand spike, then a slow recovery, all in one dataset. Built-in profiles: ${Object.keys(TEMPORAL_PROFILES).join(" | ")}. Implemented as N ordinary generate() calls (one per time segment) merged together -- see README's "Temporal scenario engine" section for what that trades off.`
  )
  .option(
    "--profile <name-or-path>",
    `a built-in profile name (${Object.keys(TEMPORAL_PROFILES).join(" | ")}) or a path to a user-authored profile YAML/JSON file`
  )
  .option("--seed <number>", "base seed -- each segment derives its own distinct seed from this", parseIntArg)
  .option("--locale <locale>", "locale for all segments")
  .option("-f, --format <format>", "output format: json | sql | csv", "json")
  .option("-o, --output <path>", "output file path", "./eco-data.json")
  .action((opts) => {
    if (!opts.profile) {
      console.error("--profile is required -- pass a built-in profile name or a path to a profile file.");
      process.exit(1);
      return;
    }

    let profile: TemporalProfile;
    if (opts.profile in TEMPORAL_PROFILES) {
      profile = TEMPORAL_PROFILES[opts.profile as string];
    } else {
      try {
        const filePath = path.resolve(process.cwd(), opts.profile as string);
        const raw = readFileSync(filePath, "utf-8");
        const ext = path.extname(filePath).toLowerCase();
        profile = (ext === ".json" ? JSON.parse(raw) : loadYaml(raw)) as TemporalProfile;
      } catch (err) {
        console.error(`Could not load profile "${opts.profile}": ${(err as Error).message}`);
        process.exit(1);
        return;
      }
    }

    const baseOverrides: Partial<EcoFakerConfig> = {};
    if (opts.seed !== undefined) baseOverrides.seed = opts.seed as number;
    if (opts.locale) baseOverrides.locale = opts.locale as Locale;

    let dataset;
    try {
      dataset = generateWithTemporalProfile(baseOverrides, profile, Date.now());
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
      return;
    }

    const format = (opts.format as OutputFormat) ?? "json";
    const outputPath = path.resolve(process.cwd(), opts.output as string);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialize(dataset, format), "utf-8");

    console.log(`Generated "${profile.name}" (${profile.segments.length} segments): ${dataset.users.length} users, ${dataset.orders.length} orders.`);
    for (const segment of profile.segments) {
      console.log(`  ${segment.label ?? "(segment)"}: ${segment.fromDaysAgo}-${segment.toDaysAgo} days ago${segment.scenario ? ` (${segment.scenario})` : ""}`);
    }
    console.log(`Written to ${outputPath} (${format})`);
  });

program
  .command("mcp")
  .description(
    "Run eco-faker as an MCP server over stdio -- exposes generate_dataset, generate_temporal_dataset, generate_otel_traces, query_table, fuzz_dataset, fraud_simulate, compute_analytics, build_event_stream, resolve_scenario_file, lint_dataset, visualize_journey, and list_scenarios as tools an MCP client (Claude Desktop, Claude Code, etc.) can call directly. See README's \"MCP server\" section for client config."
  )
  .action(async () => {
    await runMcpServer();
  });

program
  .command("docs")
  .description(
    "Open the relevant section of the README in your browser -- e.g. `my-eco-gen docs score` opens the realism-score section. Prints the resolved URL either way, so it's still useful in a headless/CI environment where nothing actually opens."
  )
  .argument("[topic]", "a word or phrase to match against real README section headings (case-insensitive substring match). Omit to open the README's top.")
  .action((topic: string | undefined) => {
    const readmePath = path.join(packageRoot, "README.md");
    let headings: ReturnType<typeof parseReadmeHeadings> = [];
    try {
      headings = parseReadmeHeadings(readFileSync(readmePath, "utf-8"));
    } catch {
      // README.md not found alongside this install -- fall back to just
      // opening the repo's README page rather than failing outright.
    }

    let packageJson: { repository?: { url?: string } | string; homepage?: string } = {};
    try {
      packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf-8"));
    } catch {
      // Fine -- buildDocsUrl falls back to a hardcoded repo URL without this.
    }

    const match = topic ? resolveDocsTopic(topic, headings) : null;
    if (topic && !match) {
      console.error(`No README section matches "${topic}". Available sections:`);
      for (const h of headings) console.error(`  ${h.text}`);
      process.exit(1);
    }

    const url = buildDocsUrl(packageJson, match);
    console.log(url);

    // spawn (not exec) with stdio: "ignore" and detached: true, then
    // unref() -- exec()'s internal stdout/stderr pipes kept this process's
    // event loop alive even after unref()ing the ChildProcess itself, so
    // the CLI hung indefinitely in a non-TTY context (a real CLI-spawning
    // test hung until killed before this was fixed). This is the actual
    // fire-and-forget pattern: no piped stdio to keep anything open, a
    // detached child that survives this process exiting, and unref() so
    // this process doesn't wait around for it either.
    const [command, args] =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.on("error", (err) => console.error(`(couldn't auto-open a browser -- open the URL above manually: ${err.message})`));
      child.unref();
    } catch (err) {
      console.error(`(couldn't auto-open a browser -- open the URL above manually: ${(err as Error).message})`);
    }
  });

program
  .command("completion")
  .description(`Print a shell completion script for bash/zsh/fish, derived from the real, current set of subcommands and flags. Load it with: eval "$(my-eco-gen completion <shell>)"`)
  .argument("<shell>", `one of: ${SUPPORTED_SHELLS.join(", ")}`)
  .action((shell: string) => {
    if (!(SUPPORTED_SHELLS as readonly string[]).includes(shell)) {
      console.error(`Unknown shell "${shell}". Supported: ${SUPPORTED_SHELLS.join(", ")}.`);
      process.exit(1);
    }
    const commands: CompletionCommandInfo[] = program.commands.map((c) => ({
      name: c.name(),
      flags: c.options.map((o) => o.long).filter((long): long is string => Boolean(long)),
    }));
    process.stdout.write(generateCompletion(shell as Shell, "my-eco-gen", commands));
  });

program.parse();

function detectSchemaType(schemaPath: string): "prisma" | "drizzle" | "sqlalchemy" | "openapi" | undefined {
  if (schemaPath.endsWith(".prisma")) return "prisma";
  if (schemaPath.endsWith(".py")) return "sqlalchemy";
  if (schemaPath.endsWith(".ts") || schemaPath.endsWith(".js")) return "drizzle";
  if (schemaPath.endsWith(".json")) return "openapi";
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
  if (opts.catalogSize !== undefined) overrides.catalogSize = opts.catalogSize as number;

  const anomalies: Partial<EcoFakerConfig["anomalies"]> = {};
  if (opts.anomalies === false) anomalies.enabled = false;
  if (opts.botCartRate !== undefined) anomalies.botCartRate = opts.botCartRate as number;
  if (opts.remoteShippingRate !== undefined) anomalies.remoteShippingRate = opts.remoteShippingRate as number;
  if (opts.contradictoryReturnRate !== undefined) anomalies.contradictoryReturnRate = opts.contradictoryReturnRate as number;
  if (Object.keys(anomalies).length > 0) {
    overrides.anomalies = anomalies as EcoFakerConfig["anomalies"];
  }
  if (opts.recommendationData === false) {
    overrides.recommendationData = { enabled: false };
  }
  if (opts.inventorySimulation === false) {
    overrides.inventorySimulation = { enabled: false };
  }
  if (opts.supportTickets === false) {
    overrides.supportTickets = { enabled: false };
  }
  if (opts.emailMessages === false) {
    overrides.emailMessages = { enabled: false };
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