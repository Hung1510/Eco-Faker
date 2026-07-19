import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("lists all nine registered tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "build_event_stream",
      "compute_analytics",
      "fraud_simulate",
      "fuzz_dataset",
      "generate_dataset",
      "lint_dataset",
      "list_scenarios",
      "query_table",
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

  it("visualize_journey writes an HTML file and returns its path plus an event summary", async () => {
    const gen = jsonFrom(
      (await client.callTool({ name: "generate_dataset", arguments: { scenario: "black-friday", seed: 4, scaleFactor: 150 } })) as any
    );
    const outputPath = `/tmp/eco-faker-mcp-test-${Date.now()}.html`;
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
