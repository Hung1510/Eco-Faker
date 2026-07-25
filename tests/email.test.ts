import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";

describe("transactional emails", () => {
  it("is enabled by default and produces all five email types", () => {
    const dataset = generate({ seed: 1, scaleFactor: 300 });
    const types = new Set(dataset.emailMessages.map((e) => e.type));
    expect(types).toEqual(
      new Set(["order_confirmation", "shipping_notification", "delivery_confirmation", "cart_abandonment_recovery", "return_confirmation"])
    );
  });

  it("produces nothing when emailMessages.enabled is false", () => {
    const dataset = generate({ seed: 1, scaleFactor: 300, emailMessages: { enabled: false } });
    expect(dataset.emailMessages).toEqual([]);
  });

  it("is deterministic for a given seed", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const a = generate({ seed: 4, scaleFactor: 200 }, referenceNow);
    const b = generate({ seed: 4, scaleFactor: 200 }, referenceNow);
    expect(JSON.stringify(a.emailMessages)).toBe(JSON.stringify(b.emailMessages));
  });

  it("enabling/disabling emailMessages does not change any other table's output, including support tickets", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const withEmails = generate({ seed: 4, scaleFactor: 200, emailMessages: { enabled: true } }, referenceNow);
    const withoutEmails = generate({ seed: 4, scaleFactor: 200, emailMessages: { enabled: false } }, referenceNow);
    expect(JSON.stringify(withEmails.orders)).toBe(JSON.stringify(withoutEmails.orders));
    expect(JSON.stringify(withEmails.supportTickets)).toBe(JSON.stringify(withoutEmails.supportTickets));
    expect(JSON.stringify(withEmails.productViews)).toBe(JSON.stringify(withoutEmails.productViews));
  });

  it("no email timestamp is ever after referenceNow", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const dataset = generate({ seed: 3, scaleFactor: 400 }, referenceNow);
    expect(dataset.emailMessages.length).toBeGreaterThan(0);
    for (const e of dataset.emailMessages) {
      expect(Date.parse(e.sentAt)).toBeLessThanOrEqual(referenceNow);
    }
  });

  it("every email references a real userId", () => {
    const dataset = generate({ seed: 2, scaleFactor: 300 });
    const userIds = new Set(dataset.users.map((u) => u.id));
    for (const e of dataset.emailMessages) {
      expect(userIds.has(e.userId)).toBe(true);
    }
  });

  describe("grounding", () => {
    it("order_confirmation is sent shortly after the order's own real createdAt", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const ordersById = new Map(dataset.orders.map((o) => [o.id, o]));
      const confirmations = dataset.emailMessages.filter((e) => e.type === "order_confirmation");
      expect(confirmations.length).toBe(dataset.orders.length);
      for (const email of confirmations.slice(0, 20)) {
        const order = ordersById.get(email.orderId!)!;
        const delta = Date.parse(email.sentAt) - Date.parse(order.createdAt);
        expect(delta).toBeGreaterThanOrEqual(0);
        expect(delta).toBeLessThanOrEqual(15 * 60 * 1000);
      }
    });

    it("shipping_notification's sentAt matches the shipment's real 'Picked Up' or 'Label Created' event, not a fabricated time", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const notifications = dataset.emailMessages.filter((e) => e.type === "shipping_notification");
      expect(notifications.length).toBeGreaterThan(0);
      const shipmentsByOrder = new Map<string, (typeof dataset.shipments)[number][]>();
      for (const s of dataset.shipments) {
        const list = shipmentsByOrder.get(s.orderId) ?? [];
        list.push(s);
        shipmentsByOrder.set(s.orderId, list);
      }
      for (const email of notifications.slice(0, 20)) {
        const shipment = shipmentsByOrder.get(email.orderId!)!.find((s) =>
          email.body.includes(s.trackingNumber)
        );
        expect(shipment).toBeDefined();
        const shippedEvent =
          shipment!.events.find((e) => e.status === "Picked Up") ?? shipment!.events.find((e) => e.status === "Label Created");
        expect(shippedEvent).toBeDefined();
        const delta = Date.parse(email.sentAt) - Date.parse(shippedEvent!.timestamp);
        expect(delta).toBeGreaterThanOrEqual(0);
        expect(delta).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
      }
    });

    it("delivery_confirmation only ever exists for shipments that actually reached a real 'Delivered' event", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const confirmations = dataset.emailMessages.filter((e) => e.type === "delivery_confirmation");
      expect(confirmations.length).toBeGreaterThan(0);
      const deliveredOrderIds = new Set(
        dataset.shipments.filter((s) => s.events.some((e) => e.status === "Delivered")).map((s) => s.orderId)
      );
      for (const email of confirmations) {
        expect(deliveredOrderIds.has(email.orderId!)).toBe(true);
      }
    });

    it("cart_abandonment_recovery's sentAt exactly matches AbandonedCheckout.recoveryEmailSentAt -- filling in real content for a timestamp that already existed", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const recoveryEmails = dataset.emailMessages.filter((e) => e.type === "cart_abandonment_recovery");
      const checkoutsWithRecoveryEmail = dataset.abandonedCheckouts.filter((c) => c.recoveryEmailSentAt !== null);
      expect(checkoutsWithRecoveryEmail.length).toBeGreaterThan(0);
      expect(recoveryEmails.length).toBe(checkoutsWithRecoveryEmail.length);

      const emailByCartId = new Map(recoveryEmails.map((e) => [e.cartId, e]));
      for (const checkout of checkoutsWithRecoveryEmail) {
        const email = emailByCartId.get(checkout.cartId);
        expect(email).toBeDefined();
        expect(email!.sentAt).toBe(checkout.recoveryEmailSentAt);
      }
    });

    it("a cart_abandonment_recovery email mentions the real coupon code when one was offered", () => {
      const dataset = generate({ seed: 2, scaleFactor: 400 });
      const withCoupon = dataset.abandonedCheckouts.find((c) => c.recoveryEmailSentAt !== null && c.couponCodeOffered !== null);
      expect(withCoupon).toBeDefined();
      const email = dataset.emailMessages.find((e) => e.type === "cart_abandonment_recovery" && e.cartId === withCoupon!.cartId);
      expect(email).toBeDefined();
      expect(email!.body).toContain(withCoupon!.couponCodeOffered);
    });

    it("return_confirmation references the return's real reason and exact real refund amount", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const confirmations = dataset.emailMessages.filter((e) => e.type === "return_confirmation");
      expect(confirmations.length).toBe(dataset.returnRequests.length);
      const returnsByOrderId = new Map(dataset.returnRequests.map((r) => [r.orderId, r]));
      for (const email of confirmations) {
        const ret = returnsByOrderId.get(email.orderId!)!;
        expect(email.body).toContain(ret.reason);
        expect(email.body).toContain(ret.refundAmountFormatted);
      }
    });
  });

  it("opened/clicked are booleans, and clicked is never true when opened is false (regression: clicking a link in an email you never opened isn't a real possibility)", () => {
    const dataset = generate({ seed: 2, scaleFactor: 300 });
    expect(dataset.emailMessages.length).toBeGreaterThan(0);
    let sawClicked = false;
    for (const e of dataset.emailMessages) {
      expect(typeof e.opened).toBe("boolean");
      expect(typeof e.clicked).toBe("boolean");
      if (e.clicked) {
        sawClicked = true;
        expect(e.opened).toBe(true);
      }
    }
    expect(sawClicked).toBe(true);
  });
});
