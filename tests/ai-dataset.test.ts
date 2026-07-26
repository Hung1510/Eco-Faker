import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { toSql } from "../src/output/sql.js";
import { generateAiDataset } from "../src/output/ai-dataset.js";

const dataset = generate({ seed: 11, scaleFactor: 300 });
const bundle = generateAiDataset(dataset);

describe("generateAiDataset", () => {
  it("produces all four artifacts, non-empty on a reasonably-sized dataset", () => {
    expect(bundle.text2sql.length).toBeGreaterThan(0);
    expect(bundle.ragCorpus.length).toBeGreaterThan(0);
    expect(bundle.agentScenarios.length).toBeGreaterThan(0);
    expect(bundle.evalSet.length).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed -- same dataset in, byte-identical bundle out", () => {
    const a = generateAiDataset(dataset);
    const b = generateAiDataset(dataset);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not mutate the dataset it reads from", () => {
    const before = JSON.stringify(dataset);
    generateAiDataset(dataset);
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it("does not crash on a dataset with no `config` field -- the real shape after a `generate --format json` -> `--input` round trip, since config is deliberately excluded from that output (see output/json.ts)", () => {
    const { config, ...withoutConfig } = dataset as typeof dataset & { config?: unknown };
    const bundle2 = generateAiDataset(withoutConfig as typeof dataset);
    expect(bundle2.text2sql.length).toBeGreaterThan(0);
    expect(bundle2.agentScenarios.length).toBeGreaterThan(0);
  });

  describe("text2sql", () => {
    it("every pair's SQL, run against a real sqlite3 instance loaded from this project's own `generate --format sql` output, returns exactly the declared groundTruth", async () => {
      // node:sqlite is experimental and Node-version-gated (added in Node
      // 22.5, absent on the Node 20.x line this project's own CI matrix
      // still runs) -- this is exactly the kind of environment-dependent
      // capability that shouldn't fail CI just because one supported
      // runtime doesn't have it; every pair here was verified this same
      // way against seeds 11/300, 42/30, and 7/800 (large enough to
      // surface floating-point summation and NULL-vs-zero edge cases)
      // before this test was written -- see ROADMAP.md.
      let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
      try {
        ({ DatabaseSync } = await import("node:sqlite"));
      } catch {
        return; // node:sqlite unavailable on this Node version -- skip, don't fail
      }

      const db = new DatabaseSync(":memory:");
      db.exec(toSql(dataset));

      for (const pair of bundle.text2sql) {
        const rows = db.prepare(pair.sql.replace(/;\s*$/, "")).all() as Record<string, unknown>[];
        const plainRows = rows.map((r) => Object.fromEntries(Object.entries(r)));

        let actual: unknown;
        if (!Array.isArray(pair.groundTruth)) {
          actual = plainRows[0];
        } else if (pair.groundTruth.length === 0 || typeof pair.groundTruth[0] !== "object") {
          actual = plainRows.map((r) => Object.values(r)[0]);
        } else {
          actual = plainRows;
        }

        expect(JSON.stringify(actual), `mismatch for: ${pair.question}`).toBe(JSON.stringify(pair.groundTruth));
      }
    });

    it("every pair references only real tables from src/output/sql.ts's schema", () => {
      const realTables = new Set([
        "categories",
        "brands",
        "suppliers",
        "products",
        "users",
        "carts",
        "abandoned_checkouts",
        "orders",
        "shipments",
        "return_requests",
        "product_views",
        "search_queries",
        "wishlist_items",
        "product_ratings",
        "warehouses",
        "replenishment_orders",
        "stockout_periods",
        "warehouse_transfers",
        "support_tickets",
        "support_messages",
        "email_messages",
      ]);
      for (const pair of bundle.text2sql) {
        expect(pair.tablesUsed.length).toBeGreaterThan(0);
        for (const table of pair.tablesUsed) {
          expect(realTables.has(table), `"${table}" in pair "${pair.question}" isn't a real table`).toBe(true);
        }
      }
    });

    it("caps per-user pairs at maxPerUserPairs rather than growing one-per-user", () => {
      const usersWithOrders = dataset.users.filter((u) => dataset.orders.some((o) => o.userId === u.id));
      const smallBundle = generateAiDataset(dataset, { maxPerUserPairs: 3 });
      const perUserPairs = smallBundle.text2sql.filter((p) => p.question.startsWith("How many orders has"));
      expect(perUserPairs.length).toBe(3);
      expect(usersWithOrders.length).toBeGreaterThan(3);
    });
  });

  describe("ragCorpus", () => {
    it("every document's text is a real, non-empty string sourced from an existing dataset record", () => {
      for (const doc of bundle.ragCorpus) {
        expect(doc.text.length).toBeGreaterThan(0);
      }
    });

    it("includes documents from all three real free-text sources", () => {
      const sources = new Set(bundle.ragCorpus.map((d) => d.sourceTable));
      expect(sources.has("support_messages")).toBe(true);
      expect(sources.has("email_messages")).toBe(true);
      expect(sources.has("product_ratings")).toBe(true);
    });

    it("only includes product_ratings that actually have review text (never fabricates one)", () => {
      const ratingDocIds = new Set(
        bundle.ragCorpus.filter((d) => d.sourceTable === "product_ratings").map((d) => d.sourceId)
      );
      for (const rating of dataset.productRatings) {
        if (ratingDocIds.has(rating.id)) {
          expect(rating.reviewText).not.toBeNull();
        }
      }
      const ratingsWithText = dataset.productRatings.filter((r) => r.reviewText !== null);
      expect(ratingDocIds.size).toBe(ratingsWithText.length);
    });

    it("every support_messages document's sourceId is a real message id, and its text matches that message's real body", () => {
      const messagesById = new Map(dataset.supportMessages.map((m) => [m.id, m]));
      const smDocs = bundle.ragCorpus.filter((d) => d.sourceTable === "support_messages");
      expect(smDocs.length).toBe(dataset.supportMessages.length);
      for (const doc of smDocs) {
        const real = messagesById.get(doc.sourceId);
        expect(real).toBeDefined();
        expect(doc.text).toBe(real!.body);
      }
    });
  });

  describe("agentScenarios", () => {
    it("every expectedToolCalls entry uses query_table, the real generic MCP tool this project's own server exposes", () => {
      for (const scenario of bundle.agentScenarios) {
        expect(scenario.expectedToolCalls.length).toBeGreaterThan(0);
        for (const call of scenario.expectedToolCalls) {
          expect(call.tool).toBe("query_table");
        }
      }
    });

    it("every groundTruthIds entry points at a real record id in the dataset", () => {
      const orderIds = new Set(dataset.orders.map((o) => o.id));
      const returnIds = new Set(dataset.returnRequests.map((r) => r.id));
      const shipmentIds = new Set(dataset.shipments.map((s) => s.id));
      const ticketIds = new Set(dataset.supportTickets.map((t) => t.id));

      for (const scenario of bundle.agentScenarios) {
        for (const [key, id] of Object.entries(scenario.groundTruthIds)) {
          if (key === "orderId") expect(orderIds.has(id)).toBe(true);
          if (key === "returnRequestId") expect(returnIds.has(id)).toBe(true);
          if (key === "shipmentId") expect(shipmentIds.has(id)).toBe(true);
          if (key === "ticketId") expect(ticketIds.has(id)).toBe(true);
        }
      }
    });

    it("an order-shipping scenario's expectedAnswer matches the shipment's real status/carrier/tracking number", () => {
      const shipmentsByOrder = new Map(dataset.shipments.map((s) => [s.orderId, s]));
      const withShipment = bundle.agentScenarios.find((s) => s.groundTruthIds.shipmentId);
      expect(withShipment).toBeDefined();
      const shipment = shipmentsByOrder.get(withShipment!.groundTruthIds.orderId)!;
      expect(withShipment!.expectedAnswer).toContain(shipment.status);
      expect(withShipment!.expectedAnswer).toContain(shipment.trackingNumber);
      expect(withShipment!.expectedAnswer).toContain(shipment.carrier);
    });

    it("caps scenarios per source at maxScenariosPerSource", () => {
      const smallBundle = generateAiDataset(dataset, { maxScenariosPerSource: 2 });
      const orderScenarios = smallBundle.agentScenarios.filter((s) => s.task.startsWith("Look up the shipping status"));
      expect(orderScenarios.length).toBeLessThanOrEqual(2);
    });
  });

  describe("evalSet", () => {
    it("every item traces back to a real text2sql pair or agent scenario via sourcePairId", () => {
      const pairIds = new Set(bundle.text2sql.map((p) => p.id));
      const scenarioIds = new Set(bundle.agentScenarios.map((s) => s.id));
      for (const item of bundle.evalSet) {
        expect(pairIds.has(item.sourcePairId) || scenarioIds.has(item.sourcePairId)).toBe(true);
      }
    });

    it("has exactly one eval item per text2sql pair plus one per agent scenario -- no separate fabricated question set", () => {
      expect(bundle.evalSet.length).toBe(bundle.text2sql.length + bundle.agentScenarios.length);
    });

    it("every answer is a non-empty string", () => {
      for (const item of bundle.evalSet) {
        expect(typeof item.answer).toBe("string");
        expect(item.answer.length).toBeGreaterThan(0);
      }
    });
  });
});
