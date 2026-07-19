import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { applyFraudSimulation, summarizeFraudSignals } from "../src/fraud.js";
import { lintDataset } from "../src/lint.js";

describe("fraud simulation engine", () => {
  it("does not mutate the input dataset -- returns a deep copy", () => {
    const dataset = generate({ seed: 4, scaleFactor: 200 });
    const before = JSON.stringify(dataset);
    applyFraudSimulation(dataset, { fraudRate: 0.2, seed: 1 });
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it("is deterministic for a given seed", () => {
    const dataset = generate({ seed: 4, scaleFactor: 200 });
    const a = applyFraudSimulation(dataset, { fraudRate: 0.1, seed: 42 });
    const b = applyFraudSimulation(dataset, { fraudRate: 0.1, seed: 42 });
    expect(JSON.stringify(a.signals)).toBe(JSON.stringify(b.signals));
  });

  it("roughly flags the requested fraction of orders (within a reasonable band)", () => {
    const dataset = generate({ seed: 4, scaleFactor: 500 });
    const { signals } = applyFraudSimulation(dataset, {
      fraudRate: 0.1,
      seed: 3,
      types: ["stolen_card", "account_farming", "reseller_behavior"], // no return-linked types, so realized rate should track requested closely
    });
    const rate = signals.length / dataset.orders.length;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.15);
  });

  it("every flagged order in the mutated dataset actually carries the matching fraud tag", () => {
    const dataset = generate({ seed: 4, scaleFactor: 300 });
    const { dataset: mutated, signals } = applyFraudSimulation(dataset, { fraudRate: 0.1, seed: 5 });
    for (const signal of signals) {
      const order = mutated.orders.find((o) => o.id === signal.orderId)!;
      expect(order.fraud).toBeDefined();
      expect(order.fraud!.fraudType).toBe(signal.fraudType);
      expect(order.fraud!.riskScore).toBe(signal.riskScore);
    }
  });

  it("riskScore is always in [0,100] and signals is a non-empty array of strings", () => {
    const dataset = generate({ seed: 4, scaleFactor: 300 });
    const { signals } = applyFraudSimulation(dataset, { fraudRate: 0.15, seed: 6 });
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.riskScore).toBeGreaterThanOrEqual(0);
      expect(s.riskScore).toBeLessThanOrEqual(100);
      expect(Array.isArray(s.signals)).toBe(true);
      expect(s.signals.length).toBeGreaterThan(0);
      expect(s.signals.every((sig) => typeof sig === "string")).toBe(true);
    }
  });

  describe("account_farming is structurally grounded -- addresses are actually shared, not just labeled", () => {
    it("the flagged order's user address is shared by the number of accounts the signal claims", () => {
      const dataset = generate({ seed: 4, scaleFactor: 300 });
      const { dataset: mutated, signals } = applyFraudSimulation(dataset, {
        fraudRate: 0.3,
        seed: 7,
        types: ["account_farming"],
      });
      expect(signals.length).toBeGreaterThan(0);

      const farming = signals.find((s) => s.fraudType === "account_farming")!;
      const claimedCount = Number(farming.signals[0].match(/shared_address_with_(\d+)_other_accounts/)![1]);

      const sourceOrder = mutated.orders.find((o) => o.id === farming.orderId)!;
      const sourceUser = mutated.users.find((u) => u.id === sourceOrder.userId)!;
      const sharedCount = mutated.users.filter(
        (u) => u.id !== sourceUser.id && JSON.stringify(u.address) === JSON.stringify(sourceUser.address)
      ).length;

      expect(sharedCount).toBe(claimedCount);
    });
  });

  describe("reseller_behavior is structurally grounded -- quantity is actually bumped, and financials stay consistent", () => {
    it("the flagged order has an implausibly high quantity line item, and lint reports no financial mismatch", () => {
      const dataset = generate({ seed: 4, scaleFactor: 300 });
      const { dataset: mutated, signals } = applyFraudSimulation(dataset, {
        fraudRate: 0.3,
        seed: 8,
        types: ["reseller_behavior"],
      });
      const reseller = signals.find((s) => s.fraudType === "reseller_behavior");
      expect(reseller).toBeDefined();

      const order = mutated.orders.find((o) => o.id === reseller!.orderId)!;
      expect(order.items.some((i) => i.quantity >= 50)).toBe(true);

      // Unlike fuzz's mutations, reseller_behavior should NOT trip the linter --
      // the whole point is a believable, internally-consistent pattern.
      const issues = lintDataset(mutated).filter((i) => i.recordId === order.id);
      expect(issues).toEqual([]);
    });
  });

  describe("return-linked fraud types are only ever assigned to orders with a real linked return", () => {
    it("refund_abuse and friendly_chargeback orders all have a matching ReturnRequest", () => {
      const dataset = generate({ seed: 4, scaleFactor: 500 });
      const { dataset: mutated, signals } = applyFraudSimulation(dataset, {
        fraudRate: 0.5,
        seed: 9,
        types: ["refund_abuse", "friendly_chargeback"],
      });
      const returnLinked = signals.filter((s) => s.fraudType === "refund_abuse" || s.fraudType === "friendly_chargeback");
      expect(returnLinked.length).toBeGreaterThan(0);
      for (const signal of returnLinked) {
        const hasReturn = mutated.returnRequests.some((r) => r.orderId === signal.orderId);
        expect(hasReturn).toBe(true);
      }
    });

    it("if no orders have returns, return-linked types simply produce zero signals rather than a bogus tag", () => {
      // scaleFactor small enough that returnRate might legitimately produce zero returns in some seeds --
      // regardless, no return-linked signal should ever exist without a real return.
      const dataset = generate({ seed: 99, scaleFactor: 30 });
      const { signals } = applyFraudSimulation(dataset, {
        fraudRate: 1, // consider every order
        seed: 1,
        types: ["refund_abuse", "friendly_chargeback"],
      });
      for (const s of signals) {
        expect(dataset.returnRequests.some((r) => r.orderId === s.orderId)).toBe(true);
      }
    });
  });

  it("restricting --types only ever produces the requested fraud types", () => {
    const dataset = generate({ seed: 4, scaleFactor: 300 });
    const { signals } = applyFraudSimulation(dataset, { fraudRate: 0.2, seed: 10, types: ["stolen_card"] });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.fraudType === "stolen_card")).toBe(true);
  });

  it("summarizeFraudSignals groups counts by type and totals match", () => {
    const dataset = generate({ seed: 4, scaleFactor: 300 });
    const { signals } = applyFraudSimulation(dataset, { fraudRate: 0.15, seed: 11 });
    const summary = summarizeFraudSignals(signals);
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    expect(total).toBe(signals.length);
  });
});
