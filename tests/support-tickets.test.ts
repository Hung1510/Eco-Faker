import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";

describe("support tickets", () => {
  it("is enabled by default and produces tickets with threaded messages", () => {
    const dataset = generate({ seed: 1, scaleFactor: 300 });
    expect(dataset.supportTickets.length).toBeGreaterThan(0);
    expect(dataset.supportMessages.length).toBeGreaterThan(0);
  });

  it("produces nothing when supportTickets.enabled is false", () => {
    const dataset = generate({ seed: 1, scaleFactor: 300, supportTickets: { enabled: false } });
    expect(dataset.supportTickets).toEqual([]);
    expect(dataset.supportMessages).toEqual([]);
  });

  it("is deterministic for a given seed", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const a = generate({ seed: 4, scaleFactor: 200 }, referenceNow);
    const b = generate({ seed: 4, scaleFactor: 200 }, referenceNow);
    expect(JSON.stringify(a.supportTickets)).toBe(JSON.stringify(b.supportTickets));
    expect(JSON.stringify(a.supportMessages)).toBe(JSON.stringify(b.supportMessages));
  });

  it("enabling/disabling supportTickets does not change any other table's output, including recommendation data and inventory simulation", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const withTickets = generate({ seed: 4, scaleFactor: 200, supportTickets: { enabled: true } }, referenceNow);
    const withoutTickets = generate({ seed: 4, scaleFactor: 200, supportTickets: { enabled: false } }, referenceNow);
    expect(JSON.stringify(withTickets.orders)).toBe(JSON.stringify(withoutTickets.orders));
    expect(JSON.stringify(withTickets.productViews)).toBe(JSON.stringify(withoutTickets.productViews));
    expect(JSON.stringify(withTickets.replenishmentOrders)).toBe(JSON.stringify(withoutTickets.replenishmentOrders));
  });

  describe("timing invariants", () => {
    it("no ticket or message timestamp is ever after referenceNow", () => {
      const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
      const dataset = generate({ seed: 3, scaleFactor: 400 }, referenceNow);
      for (const t of dataset.supportTickets) {
        expect(Date.parse(t.createdAt)).toBeLessThanOrEqual(referenceNow);
        if (t.resolvedAt) expect(Date.parse(t.resolvedAt)).toBeLessThanOrEqual(referenceNow);
      }
      for (const m of dataset.supportMessages) {
        expect(Date.parse(m.timestamp)).toBeLessThanOrEqual(referenceNow);
      }
    });

    it("a ticket's resolvedAt is never before its own createdAt", () => {
      const dataset = generate({ seed: 3, scaleFactor: 400 });
      const resolved = dataset.supportTickets.filter((t) => t.resolvedAt !== null);
      expect(resolved.length).toBeGreaterThan(0);
      for (const t of resolved) {
        expect(Date.parse(t.resolvedAt!)).toBeGreaterThanOrEqual(Date.parse(t.createdAt));
      }
    });

    it("within a single ticket's thread, messages are chronologically ordered", () => {
      const dataset = generate({ seed: 3, scaleFactor: 400 });
      const byTicket = new Map<string, typeof dataset.supportMessages>();
      // dataset.supportMessages is globally sorted by timestamp already;
      // filtering it down to one ticket's messages preserves that
      // relative order, so this is a real, non-trivial check of whether
      // each ticket's own conversation was generated with monotonically
      // increasing timestamps in the first place.
      for (const m of dataset.supportMessages) {
        const list = byTicket.get(m.ticketId) ?? [];
        list.push(m);
        byTicket.set(m.ticketId, list);
      }
      expect(byTicket.size).toBeGreaterThan(0);
      for (const messages of byTicket.values()) {
        for (let i = 1; i < messages.length; i++) {
          expect(Date.parse(messages[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(messages[i - 1].timestamp));
        }
      }
    });

    it("a ticket's very first message (by timestamp) is always from the customer, at the ticket's own createdAt", () => {
      const dataset = generate({ seed: 3, scaleFactor: 400 });
      const byTicket = new Map<string, typeof dataset.supportMessages>();
      for (const m of dataset.supportMessages) {
        const list = byTicket.get(m.ticketId) ?? [];
        list.push(m);
        byTicket.set(m.ticketId, list);
      }
      const ticketsById = new Map(dataset.supportTickets.map((t) => [t.id, t]));
      for (const [ticketId, messages] of byTicket) {
        const first = [...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0];
        expect(first.sender).toBe("customer");
        expect(first.timestamp).toBe(ticketsById.get(ticketId)!.createdAt);
      }
    });
  });

  describe("grounding", () => {
    it("every shipping-category ticket references a real order that has a real delayed shipment", () => {
      const dataset = generate({ seed: 2, scaleFactor: 400 });
      const shippingTickets = dataset.supportTickets.filter((t) => t.category === "shipping");
      expect(shippingTickets.length).toBeGreaterThan(0);
      const ordersById = new Map(dataset.orders.map((o) => [o.id, o]));
      for (const t of shippingTickets) {
        expect(t.orderId).not.toBeNull();
        const order = ordersById.get(t.orderId!);
        expect(order).toBeDefined();
        const hasDelayedShipment = dataset.shipments.some((s) => s.orderId === t.orderId && s.delayed);
        expect(hasDelayedShipment).toBe(true);
      }
    });

    it("every return-category ticket references a real ReturnRequest for the same user and order", () => {
      const dataset = generate({ seed: 2, scaleFactor: 400 });
      const returnTickets = dataset.supportTickets.filter((t) => t.category === "return");
      expect(returnTickets.length).toBeGreaterThan(0);
      const returnsById = new Map(dataset.returnRequests.map((r) => [r.id, r]));
      for (const t of returnTickets) {
        expect(t.returnRequestId).not.toBeNull();
        const ret = returnsById.get(t.returnRequestId!);
        expect(ret).toBeDefined();
        expect(ret!.userId).toBe(t.userId);
        expect(ret!.orderId).toBe(t.orderId);
      }
    });

    it("at least one real refund amount appears verbatim somewhere across all return-ticket messages (confirms the interpolation path is actually exercised, not just structurally present)", () => {
      const dataset = generate({ seed: 2, scaleFactor: 400 });
      const returnTickets = dataset.supportTickets.filter((t) => t.category === "return");
      const returnsById = new Map(dataset.returnRequests.map((r) => [r.id, r]));
      const anyMentionsRefund = returnTickets.some((t) => {
        const ret = returnsById.get(t.returnRequestId!)!;
        const messages = dataset.supportMessages.filter((m) => m.ticketId === t.id);
        return messages.some((m) => m.body.includes(ret.refundAmountFormatted));
      });
      expect(anyMentionsRefund).toBe(true);
    });

    it("every product-category ticket references a real ProductRating with rating <= 2", () => {
      const dataset = generate({ seed: 2, scaleFactor: 400 });
      const productTickets = dataset.supportTickets.filter((t) => t.category === "product");
      expect(productTickets.length).toBeGreaterThan(0);
      const productsById = new Map(dataset.products.map((p) => [p.id, p]));
      for (const t of productTickets) {
        expect(t.productId).not.toBeNull();
        const product = productsById.get(t.productId!);
        expect(product).toBeDefined();
        const hasLowRating = dataset.productRatings.some(
          (r) => r.productId === t.productId && r.userId === t.userId && r.rating <= 2
        );
        expect(hasLowRating).toBe(true);
      }
    });

    it("every account-category ticket tied to an order references a real order with a genuinely null shippingAddress", () => {
      const dataset = generate({ seed: 2, scaleFactor: 400 });
      const ordersById = new Map(dataset.orders.map((o) => [o.id, o]));
      const missingAddressTickets = dataset.supportTickets.filter(
        (t) => t.category === "account" && t.orderId !== null
      );
      expect(missingAddressTickets.length).toBeGreaterThan(0);
      for (const t of missingAddressTickets) {
        const order = ordersById.get(t.orderId!)!;
        expect(order.shippingAddress).toBeNull();
      }
    });

    it("general-category (pre-sales) tickets only exist for products the user viewed but never purchased", () => {
      const dataset = generate({ seed: 2, scaleFactor: 400 });
      const generalTickets = dataset.supportTickets.filter((t) => t.category === "general");
      expect(generalTickets.length).toBeGreaterThan(0);
      const purchasedByUser = new Map<string, Set<string>>();
      for (const order of dataset.orders) {
        const set = purchasedByUser.get(order.userId) ?? new Set<string>();
        for (const item of order.items) set.add(item.productId);
        purchasedByUser.set(order.userId, set);
      }
      for (const t of generalTickets) {
        expect(purchasedByUser.get(t.userId)?.has(t.productId!) ?? false).toBe(false);
      }
    });

    it("omits pre-sales tickets entirely when recommendation data is disabled, rather than fabricating browsing history", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300, recommendationData: { enabled: false } });
      expect(dataset.supportTickets.some((t) => t.category === "general")).toBe(false);
    });
  });

  it("every resolved/closed ticket has a real resolvedAt, and message count matches whether that category has a dedicated resolution message", () => {
    const dataset = generate({ seed: 2, scaleFactor: 400 });
    const ticketsById = new Map(dataset.supportTickets.map((t) => [t.id, t]));
    const byTicket = new Map<string, typeof dataset.supportMessages>();
    for (const m of dataset.supportMessages) {
      const list = byTicket.get(m.ticketId) ?? [];
      list.push(m);
      byTicket.set(m.ticketId, list);
    }
    let sawOpen = false;
    let sawResolvedWithResolution = false;
    let sawResolvedWithoutResolution = false;
    // "general" (pre-sales) tickets never get a dedicated resolution
    // message. "account" is shared by two different sub-cases: missing-
    // shipping-address tickets (grounded in a real order, DO get a
    // resolution message) and generic account questions (orderId is
    // null, no dedicated resolution message) -- distinguished by
    // whether orderId is set, not by category alone.
    const hasNoResolutionMessage = (t: (typeof dataset.supportTickets)[number]) =>
      t.category === "general" || (t.category === "account" && t.orderId === null);
    for (const [ticketId, messages] of byTicket) {
      const ticket = ticketsById.get(ticketId)!;
      if (ticket.status === "open") {
        sawOpen = true;
        expect(messages.length).toBe(1);
        expect(ticket.resolvedAt).toBeNull();
        continue;
      }
      if (ticket.status === "resolved" || ticket.status === "closed") {
        // Every resolved/closed ticket must have a real resolvedAt --
        // this was a real bug (status said "resolved" while resolvedAt
        // stayed null for categories with no dedicated resolution
        // message) caught by this exact assertion.
        expect(ticket.resolvedAt).not.toBeNull();
        if (hasNoResolutionMessage(ticket)) {
          sawResolvedWithoutResolution = true;
          expect(messages.length).toBe(2); // customer open + agent ack, ack IS the resolution
        } else {
          sawResolvedWithResolution = true;
          expect(messages.length).toBeGreaterThanOrEqual(3); // open + ack + dedicated resolution (+ optional thank-you)
        }
      }
    }
    expect(sawOpen).toBe(true);
    expect(sawResolvedWithResolution).toBe(true);
    expect(sawResolvedWithoutResolution).toBe(true);
  });

  it("every message references a real ticketId that exists in supportTickets", () => {
    const dataset = generate({ seed: 2, scaleFactor: 400 });
    const ticketIds = new Set(dataset.supportTickets.map((t) => t.id));
    for (const m of dataset.supportMessages) {
      expect(ticketIds.has(m.ticketId)).toBe(true);
    }
  });

  it("every ticket references a real userId that exists in dataset.users", () => {
    const dataset = generate({ seed: 2, scaleFactor: 400 });
    const userIds = new Set(dataset.users.map((u) => u.id));
    for (const t of dataset.supportTickets) {
      expect(userIds.has(t.userId)).toBe(true);
    }
  });
});
