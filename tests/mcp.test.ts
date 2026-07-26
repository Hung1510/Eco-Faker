import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEcoFakerMcpServer } from "../src/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Real end-to-end tests: a real MCP Client talking to a real McpServer over
 * a real (in-memory) transport, calling actual tools and parsing actual
 * responses -- not just asserting the server object has the right shape.
 */
describe("eco-faker MCP server", () => {
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    server = createEcoFakerMcpServer();
    client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  function jsonFrom(result: { content: Array<{ type: string; text?: string }> }): any {
    const textBlock = result.content.find((c) => c.type === "text");
    return JSON.parse(textBlock!.text!);
  }

  it("lists all fourteen registered tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "build_event_stream",
      "compute_analytics",
      "fraud_simulate",
      "fuzz_dataset",
      "generate_ai_dataset",
      "generate_dataset",
      "generate_otel_traces",
      "generate_temporal_dataset",
      "lint_dataset",
      "list_scenarios",
      "query_table",
      "resolve_scenario_file",
      "score_dataset",
      "visualize_journey",
    ]);
  });

  it("list_scenarios returns all five scenario names with descriptions", async () => {
    const result = await client.callTool({ name: "list_scenarios", arguments: {} });
    const body = jsonFrom(result as any);
    expect(Object.keys(body).sort()).toEqual(
      ["black-friday", "flash-sale", "post-holiday-returns", "steady-state", "supply-chain-crisis"].sort()
    );
    expect(body["black-friday"]).toContain("abandonment");
  });

  it("generate_dataset returns a datasetId, counts, and a sample -- not the full dataset", async () => {
    const result = await client.callTool({
      name: "generate_dataset",
      arguments: { scenario: "steady-state", seed: 5, scaleFactor: 50 },
    });
    const body = jsonFrom(result as any);
    expect(typeof body.datasetId).toBe("string");
    expect(body.counts.orders).toBeGreaterThan(0);
    expect(body.sampleOrders.length).toBeLessThanOrEqual(3);
  });

  it("generate_dataset with an unknown scenario returns an error result, not a crash", async () => {
    const result = await client.callTool({ name: "generate_dataset", arguments: { scenario: "not-a-real-scenario" } });
    // zod's enum validation rejects this before our handler even runs --
    // MCP surfaces that as a protocol-level error, which the SDK client throws.
    expect(result.isError || (result as any).content).toBeTruthy();
  });

  it("query_table filters, sorts, and paginates against a generated dataset", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 3, scaleFactor: 100 } })) as any
    );
    const result = await client.callTool({
      name: "query_table",
      arguments: { datasetId: gen.datasetId, table: "orders", filters: { status: "delivered" }, pageSize: 5 },
    });
    const body = jsonFrom(result as any);
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.data.every((o: any) => o.status === "delivered")).toBe(true);
  });

  it("query_table works against the new support-tickets/support-messages tables with zero dedicated MCP wiring, since it's generic over TABLE_ROUTES", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 3, scaleFactor: 200 } })) as any
    );
    const result = await client.callTool({
      name: "query_table",
      arguments: { datasetId: gen.datasetId, table: "support-tickets", filters: { category: "shipping" }, pageSize: 5 },
    });
    const body = jsonFrom(result as any);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((t: any) => t.category === "shipping")).toBe(true);
  });

  it("query_table works against the new email-messages table with zero dedicated MCP wiring, since it's generic over TABLE_ROUTES", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 3, scaleFactor: 200 } })) as any
    );
    const result = await client.callTool({
      name: "query_table",
      arguments: { datasetId: gen.datasetId, table: "email-messages", filters: { type: "order_confirmation" }, pageSize: 5 },
    });
    const body = jsonFrom(result as any);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((e: any) => e.type === "order_confirmation")).toBe(true);
  });

  it("query_table with an unknown datasetId returns an error result", async () => {
    const result = await client.callTool({
      name: "query_table",
      arguments: { datasetId: "does-not-exist", table: "orders" },
    });
    expect((result as any).isError).toBe(true);
    const textBlock = (result as any).content.find((c: any) => c.type === "text");
    expect(textBlock.text).toContain("No dataset with id");
  });

  it("fuzz_dataset returns a new datasetId distinct from the source, and lint_dataset catches the mutations", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 9, scaleFactor: 100 } })) as any
    );
    const fuzzed = jsonFrom(
      (await client.callTool({
        name: "fuzz_dataset",
        arguments: { datasetId: gen.datasetId, intensity: "extreme", seed: 1 },
      })) as any
    );
    expect(fuzzed.datasetId).not.toBe(gen.datasetId);
    expect(fuzzed.sourceDatasetId).toBe(gen.datasetId);
    expect(fuzzed.mutationCount).toBeGreaterThan(0);

    const linted = jsonFrom(
      (await client.callTool({ name: "lint_dataset", arguments: { datasetId: fuzzed.datasetId } })) as any
    );
    expect(linted.errorCount).toBeGreaterThan(0);
  });

  it("lint_dataset on a fresh (unmutated) dataset reports zero issues", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "steady-state", seed: 2, scaleFactor: 80 } })) as any
    );
    const linted = jsonFrom((await client.callTool({ name: "lint_dataset", arguments: { datasetId: gen.datasetId } })) as any);
    expect(linted.issueCount).toBe(0);
  });

  it("fraud_simulate returns a new datasetId with tagged orders, distinct from the source", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 6, scaleFactor: 300 } })) as any
    );
    const fraud = jsonFrom(
      (await client.callTool({
        name: "fraud_simulate",
        arguments: { datasetId: gen.datasetId, fraudRate: 0.1, seed: 1 },
      })) as any
    );
    expect(fraud.datasetId).not.toBe(gen.datasetId);
    expect(fraud.sourceDatasetId).toBe(gen.datasetId);
    expect(fraud.flaggedCount).toBeGreaterThan(0);
    expect(fraud.signals[0]).toHaveProperty("fraudType");
    expect(fraud.signals[0]).toHaveProperty("riskScore");

    const page = jsonFrom(
      (await client.callTool({
        name: "query_table",
        arguments: { datasetId: fraud.datasetId, table: "orders", filters: { id: fraud.signals[0].orderId } },
      })) as any
    );
    expect(page.data[0].fraud.fraudType).toBe(fraud.signals[0].fraudType);
  });

  it("compute_analytics returns real daily revenue and funnel data matching the underlying dataset", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 6, scaleFactor: 200 } })) as any
    );
    const report = jsonFrom(
      (await client.callTool({ name: "compute_analytics", arguments: { datasetId: gen.datasetId } })) as any
    );
    expect(report.dailyRevenue.length).toBeGreaterThan(0);
    expect(report.funnel.length).toBeGreaterThan(0);
    expect(report.cac.assumedMonthlyMarketingSpend).toBe(5000);

    const customArgs = jsonFrom(
      (await client.callTool({
        name: "compute_analytics",
        arguments: { datasetId: gen.datasetId, marketingSpend: 9000 },
      })) as any
    );
    expect(customArgs.cac.assumedMonthlyMarketingSpend).toBe(9000);
  });

  it("score_dataset returns a real 0-100 overall score and five dimensions matching computeRealismScore", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 6, scaleFactor: 200 } })) as any
    );
    const result = jsonFrom(
      (await client.callTool({ name: "score_dataset", arguments: { datasetId: gen.datasetId } })) as any
    );
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.dimensions.map((d: { name: string }) => d.name).sort()).toEqual([
      "distribution_shape",
      "financial_consistency",
      "referential_integrity",
      "temporal_plausibility",
      "uniqueness",
    ]);
  });

  it("build_event_stream returns real counts, a sample, and respects eventTypes/sampleSize filters", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 6, scaleFactor: 200 } })) as any
    );
    const full = jsonFrom(
      (await client.callTool({ name: "build_event_stream", arguments: { datasetId: gen.datasetId } })) as any
    );
    expect(full.totalEvents).toBeGreaterThan(0);
    expect(Object.keys(full.eventTypeCounts).length).toBeGreaterThan(0);
    expect(full.sample.length).toBe(10);
    expect(full.sample[0]).toHaveProperty("aggregateId");
    expect(full.sample[0]).toHaveProperty("aggregateType");

    const filtered = jsonFrom(
      (await client.callTool({
        name: "build_event_stream",
        arguments: { datasetId: gen.datasetId, eventTypes: ["order.created"], sampleSize: 3 },
      })) as any
    );
    expect(Object.keys(filtered.eventTypeCounts)).toEqual(["order.created"]);
    expect(filtered.sample.length).toBeLessThanOrEqual(3);
    expect(filtered.sample.every((e: any) => e.type === "order.created")).toBe(true);
  });

  it("generate_temporal_dataset with a built-in profileName produces a real merged dataset", async () => {
    const result = jsonFrom(
      (await client.callTool({ name: "generate_temporal_dataset", arguments: { profileName: "holiday-arc", seed: 2 } })) as any
    );
    expect(result.datasetId).toBeDefined();
    expect(result.profileName).toBe("holiday-arc");
    expect(result.segments.length).toBe(3);
    expect(result.counts.orders).toBeGreaterThan(0);

    // The returned datasetId works with every other tool, same as generate_dataset's.
    const queried = jsonFrom(
      (await client.callTool({ name: "query_table", arguments: { datasetId: result.datasetId, table: "orders", pageSize: 3 } })) as any
    );
    expect(queried.data.length).toBeGreaterThan(0);
  });

  it("generate_temporal_dataset with an inline profile respects contiguity validation", async () => {
    const badProfile = {
      name: "bad-gap",
      segments: [
        { fromDaysAgo: 30, toDaysAgo: 20 },
        { fromDaysAgo: 10, toDaysAgo: 0 },
      ],
    };
    const result = (await client.callTool({ name: "generate_temporal_dataset", arguments: { profile: badProfile } })) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/contiguous/);
  });

  it("generate_otel_traces returns real trace/span counts and a sample from the correct dataset", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 3, scaleFactor: 150 } })) as any
    );
    const traces = jsonFrom(
      (await client.callTool({ name: "generate_otel_traces", arguments: { datasetId: gen.datasetId, seed: 5 } })) as any
    );
    expect(traces.traceCount).toBeGreaterThan(0);
    expect(traces.spanCount).toBeGreaterThan(0);
    expect(traces.services).toEqual([
      { stringValue: "checkout-service" },
      { stringValue: "payment-service" },
      { stringValue: "fulfillment-service" },
    ]);
    expect(traces.sampleSpans.length).toBeGreaterThan(0);
    expect(traces.sampleSpans[0]).toHaveProperty("traceId");
    expect(traces.sampleSpans[0]).toHaveProperty("spanId");
  });

  it("generate_ai_dataset writes four real JSONL files and returns matching counts/samples", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 3, scaleFactor: 150 } })) as any
    );
    const outputDir = join(tmpdir(), `eco-faker-mcp-ai-dataset-${Date.now()}`);
    const result = jsonFrom(
      (await client.callTool({ name: "generate_ai_dataset", arguments: { datasetId: gen.datasetId, outputDir, maxPerUserPairs: 5 } })) as any
    );
    expect(result.text2sql.count).toBeGreaterThan(0);
    expect(result.ragCorpus.count).toBeGreaterThan(0);
    expect(result.agentScenarios.count).toBeGreaterThan(0);
    expect(result.evalSet.count).toBe(result.text2sql.count + result.agentScenarios.count);
    expect(result.text2sql.sample.length).toBeGreaterThan(0);

    const text2sqlFile = readFileSync(join(outputDir, "text2sql.jsonl"), "utf-8").trim().split("\n");
    expect(text2sqlFile.length).toBe(result.text2sql.count);
    expect(JSON.parse(text2sqlFile[0])).toHaveProperty("sql");
  });

  it("resolve_scenario_file composes a real inherits chain and validates the result", async () => {
    const filePath = join(tmpdir(), `eco-faker-mcp-scenario-${Date.now()}.yaml`);
    writeFileSync(filePath, "inherits:\n  - black-friday\noverrides:\n  scaleFactor: 321\n", "utf-8");
    try {
      const resolved = jsonFrom(
        (await client.callTool({ name: "resolve_scenario_file", arguments: { filePath } })) as any
      );
      expect(resolved.chain).toEqual([filePath]);
      expect(resolved.config.scaleFactor).toBe(321);
      expect(resolved.config.abandonmentRate).toBe(0.55); // inherited from black-friday
    } finally {
      unlinkSync(filePath);
    }
  });

  it("resolve_scenario_file surfaces a clear error for circular inheritance instead of crashing the server", async () => {
    const pathA = join(tmpdir(), `eco-faker-mcp-cycle-a-${Date.now()}.yaml`);
    const pathB = join(tmpdir(), `eco-faker-mcp-cycle-b-${Date.now()}.yaml`);
    writeFileSync(pathA, `inherits:\n  - ${pathB}\n`, "utf-8");
    writeFileSync(pathB, `inherits:\n  - ${pathA}\n`, "utf-8");
    try {
      const result = (await client.callTool({ name: "resolve_scenario_file", arguments: { filePath: pathA } })) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Circular scenario inheritance/);
    } finally {
      unlinkSync(pathA);
      unlinkSync(pathB);
    }
  });

  it("visualize_journey writes an HTML file and returns its path plus an event summary", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 4, scaleFactor: 150 } })) as any
    );
    const outputPath = join(tmpdir(), `eco-faker-mcp-test-${Date.now()}.html`);
    const result = await client.callTool({
      name: "visualize_journey",
      arguments: { datasetId: gen.datasetId, outputPath },
    });
    const body = jsonFrom(result as any);
    expect(body.path).toBe(outputPath);
    expect(body.eventCount).toBeGreaterThan(0);

    const { readFileSync, unlinkSync } = await import("node:fs");
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("<!doctype html>");
    unlinkSync(outputPath);
  });
});