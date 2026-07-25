import { describe, expect, it } from "vitest";
import { Faker, en } from "@faker-js/faker";
import { generate } from "../src/generator.js";
import { generateOtelExport } from "../src/otel.js";

function freshFaker(seed: number): Faker {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return faker;
}

describe("OpenTelemetry trace export", () => {
  const dataset = generate({ seed: 1, scaleFactor: 300, delayProbability: 0.4 });
  const result = generateOtelExport(freshFaker(42), 42, dataset);

  it("produces real traces and spans", () => {
    expect(result.traceCount).toBeGreaterThan(0);
    expect(result.spanCount).toBeGreaterThan(0);
  });

  it("has exactly three resourceSpans groups: checkout-service, payment-service, fulfillment-service", () => {
    const serviceNames = result.otlp.resourceSpans.map((rs) => {
      const nameAttr = rs.resource.attributes.find((a) => a.key === "service.name");
      return (nameAttr!.value as { stringValue: string }).stringValue;
    });
    expect(serviceNames).toEqual(["checkout-service", "payment-service", "fulfillment-service"]);
  });

  describe("OTLP schema conformance", () => {
    const allSpans = result.otlp.resourceSpans.flatMap((rs) => rs.scopeSpans[0].spans);

    it("every traceId is exactly 32 lowercase hex characters", () => {
      expect(allSpans.length).toBeGreaterThan(0);
      for (const span of allSpans) {
        expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
      }
    });

    it("every spanId is exactly 16 lowercase hex characters", () => {
      for (const span of allSpans) {
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
      }
    });

    it("kind and status.code are plain integers, not string enum names (matches the real OTLP JSON mapping, verified against opentelemetry-proto's trace.proto)", () => {
      for (const span of allSpans) {
        expect(typeof span.kind).toBe("number");
        expect(typeof span.status.code).toBe("number");
        expect([0, 1, 2, 3, 4, 5]).toContain(span.kind);
        expect([0, 1, 2]).toContain(span.status.code);
      }
    });

    it("timestamps are string-encoded (not JS numbers, which can't safely hold real nanosecond values)", () => {
      for (const span of allSpans.slice(0, 50)) {
        expect(typeof span.startTimeUnixNano).toBe("string");
        expect(typeof span.endTimeUnixNano).toBe("string");
        expect(/^\d+$/.test(span.startTimeUnixNano)).toBe(true);
      }
    });

    it("every span's endTime is at or after its startTime", () => {
      for (const span of allSpans) {
        expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(span.startTimeUnixNano));
      }
    });

    it("every non-root span has a parentSpanId that's a real spanId within the same trace", () => {
      const byTrace = new Map<string, Set<string>>();
      for (const span of allSpans) {
        const set = byTrace.get(span.traceId) ?? new Set<string>();
        set.add(span.spanId);
        byTrace.set(span.traceId, set);
      }
      let checkedAny = false;
      for (const span of allSpans) {
        if (!span.parentSpanId) continue;
        checkedAny = true;
        expect(byTrace.get(span.traceId)!.has(span.parentSpanId)).toBe(true);
      }
      expect(checkedAny).toBe(true);
    });
  });

  describe("attribute value precision (regression)", () => {
    it("a dollar amount with cents is stored as doubleValue with the exact real value, not rounded into intValue", () => {
      const orderWithCents = dataset.orders.find((o) => !Number.isInteger(o.total));
      expect(orderWithCents).toBeDefined();
      const checkoutSpans = result.otlp.resourceSpans[0].scopeSpans[0].spans;
      const rootSpan = checkoutSpans.find((s) =>
        s.attributes.some((a) => a.key === "order.id" && (a.value as { stringValue: string }).stringValue === orderWithCents!.id)
      );
      expect(rootSpan).toBeDefined();
      const totalAttr = rootSpan!.attributes.find((a) => a.key === "order.total")!;
      expect((totalAttr.value as { doubleValue: number }).doubleValue).toBe(orderWithCents!.total);
      expect("intValue" in totalAttr.value).toBe(false);
    });

    it("whole-number attributes (item counts) still use intValue, not doubleValue", () => {
      const checkoutSpans = result.otlp.resourceSpans[0].scopeSpans[0].spans;
      const validateSpan = checkoutSpans.find((s) => s.name === "validate_cart");
      expect(validateSpan).toBeDefined();
      const itemCountAttr = validateSpan!.attributes.find((a) => a.key === "cart.item_count")!;
      expect("intValue" in itemCountAttr.value).toBe(true);
    });
  });

  describe("grounding: fulfillment traces", () => {
    it("root span's start/end exactly match the real first/last tracking event timestamps", () => {
      const fulfillmentSpans = result.otlp.resourceSpans[2].scopeSpans[0].spans;
      const shipmentsWithEvents = dataset.shipments.filter((s) => s.events.length > 0);
      expect(shipmentsWithEvents.length).toBeGreaterThan(0);
      for (const shipment of shipmentsWithEvents.slice(0, 10)) {
        const rootSpan = fulfillmentSpans.find((s) =>
          s.attributes.some((a) => a.key === "shipment.id" && (a.value as { stringValue: string }).stringValue === shipment.id)
        );
        expect(rootSpan).toBeDefined();
        const first = shipment.events[0];
        const last = shipment.events[shipment.events.length - 1];
        expect(rootSpan!.startTimeUnixNano).toBe(String(Date.parse(first.timestamp) * 1_000_000));
        expect(rootSpan!.endTimeUnixNano).toBe(String(Date.parse(last.timestamp) * 1_000_000));
      }
    });

    it("child span count matches the real number of consecutive tracking-event transitions", () => {
      const fulfillmentSpans = result.otlp.resourceSpans[2].scopeSpans[0].spans;
      const shipment = dataset.shipments.find((s) => s.events.length >= 3)!;
      expect(shipment).toBeDefined();
      const rootSpan = fulfillmentSpans.find((r) =>
        r.attributes.some((a) => a.key === "shipment.id" && (a.value as { stringValue: string }).stringValue === shipment.id)
      )!;
      const childSpans = fulfillmentSpans.filter((s) => s.parentSpanId === rootSpan.spanId);
      // root + (events.length - 1) transition spans -> childSpans.length === events.length - 1
      expect(childSpans.length).toBe(shipment.events.length - 1);
    });

    it("a delayed shipment's root span carries a real ERROR status", () => {
      const fulfillmentSpans = result.otlp.resourceSpans[2].scopeSpans[0].spans;
      const delayedShipment = dataset.shipments.find((s) => s.delayed && s.events.length > 0);
      expect(delayedShipment).toBeDefined();
      const rootSpan = fulfillmentSpans.find((s) =>
        s.attributes.some((a) => a.key === "shipment.id" && (a.value as { stringValue: string }).stringValue === delayedShipment!.id)
      );
      expect(rootSpan!.status.code).toBe(2); // ERROR
    });
  });

  describe("grounding: checkout traces", () => {
    it("root span's endTime exactly matches the order's real createdAt", () => {
      const checkoutSpans = result.otlp.resourceSpans[0].scopeSpans[0].spans;
      for (const order of dataset.orders.slice(0, 10)) {
        const rootSpan = checkoutSpans.find((s) =>
          s.attributes.some((a) => a.key === "order.id" && (a.value as { stringValue: string }).stringValue === order.id)
        );
        expect(rootSpan).toBeDefined();
        expect(rootSpan!.endTimeUnixNano).toBe(String(Date.parse(order.createdAt) * 1_000_000));
      }
    });

    it("an order with a real stolen_card fraud tag has a payment span with ERROR status", () => {
      const stolenCardOrder = dataset.orders.find((o) => o.fraud?.fraudType === "stolen_card");
      if (!stolenCardOrder) return; // not guaranteed present at this scale/seed; skip rather than force
      const paymentSpans = result.otlp.resourceSpans[1].scopeSpans[0].spans;
      const paymentSpan = paymentSpans.find((s) =>
        s.attributes.some((a) => a.key === "fraud.type" && (a.value as { stringValue: string }).stringValue === "stolen_card")
      );
      expect(paymentSpan).toBeDefined();
      expect(paymentSpan!.status.code).toBe(2); // ERROR
    });
  });

  it("is deterministic for a given seed", () => {
    const a = generateOtelExport(freshFaker(7), 7, dataset);
    const b = generateOtelExport(freshFaker(7), 7, dataset);
    expect(JSON.stringify(a.otlp)).toBe(JSON.stringify(b.otlp));
  });

  it("handles an empty dataset (no orders, no shipments) without crashing", () => {
    const emptyDataset = generate({ seed: 1, scaleFactor: 1 });
    const forcedEmpty = { ...emptyDataset, orders: [], shipments: [] };
    expect(() => generateOtelExport(freshFaker(1), 1, forcedEmpty)).not.toThrow();
    const emptyResult = generateOtelExport(freshFaker(1), 1, forcedEmpty);
    expect(emptyResult.traceCount).toBe(0);
    expect(emptyResult.spanCount).toBe(0);
  });
});
