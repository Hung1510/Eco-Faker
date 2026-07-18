import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { buildUserJourney, pickRichestUserId, renderJourneyHtml } from "../src/visualize.js";

describe("buildUserJourney", () => {
  it("throws for an unknown user id", () => {
    const dataset = generate({ seed: 2, scaleFactor: 60 });
    expect(() => buildUserJourney(dataset, "does-not-exist")).toThrow(/No user with id/);
  });

  it("always starts with user.created and is chronologically ordered", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    const userId = pickRichestUserId(dataset);
    const events = buildUserJourney(dataset, userId);
    expect(events[0].type).toBe("user.created");
    for (let i = 1; i < events.length; i++) {
      expect(Date.parse(events[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(events[i - 1].timestamp));
    }
  });

  it("includes order.created for every order the user placed", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    const userWithOrder = dataset.orders[0].userId;
    const events = buildUserJourney(dataset, userWithOrder);
    const orderCount = dataset.orders.filter((o) => o.userId === userWithOrder).length;
    expect(events.filter((e) => e.type === "order.created").length).toBe(orderCount);
  });

  it("includes shipment tracking events for a user's orders", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    // find a user whose order has at least one shipment
    const order = dataset.orders.find((o) => dataset.shipments.some((s) => s.orderId === o.id));
    expect(order).toBeDefined();
    const events = buildUserJourney(dataset, order!.userId);
    expect(events.some((e) => e.type.startsWith("shipment."))).toBe(true);
  });

  it("only includes events belonging to the requested user, not other users", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    const [userA, userB] = dataset.users;
    const eventsA = buildUserJourney(dataset, userA.id);
    // No cart/order/return record referencing userB's id should leak into userA's journey.
    const userBOrderIds = new Set(dataset.orders.filter((o) => o.userId === userB.id).map((o) => o.id.slice(0, 8)));
    expect(eventsA.some((e) => userBOrderIds.has(e.label.split("#")[1] ?? ""))).toBe(false);
  });
});

describe("pickRichestUserId", () => {
  it("picks a user id that actually exists in the dataset", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    const userId = pickRichestUserId(dataset);
    expect(dataset.users.some((u) => u.id === userId)).toBe(true);
  });

  it("picks a user with at least as many order/return events as any other user", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    const userId = pickRichestUserId(dataset);
    const score = (id: string) =>
      dataset.orders.filter((o) => o.userId === id).length * 2 +
      dataset.returnRequests.filter((r) => r.userId === id).length * 2 +
      dataset.carts.filter((c) => c.userId === id).length +
      dataset.abandonedCheckouts.filter((c) => c.userId === id).length;
    const best = score(userId);
    for (const user of dataset.users) {
      expect(score(user.id)).toBeLessThanOrEqual(best);
    }
  });
});

describe("renderJourneyHtml", () => {
  it("produces a self-contained HTML document embedding the event payload", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    const userId = pickRichestUserId(dataset);
    const user = dataset.users.find((u) => u.id === userId)!;
    const events = buildUserJourney(dataset, userId);
    const html = renderJourneyHtml(user, events);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("scaleTime"); // confirms D3 is inlined, not loaded from a CDN
    expect(html).not.toContain("cdnjs.cloudflare.com"); // must work fully offline
    expect(html).toContain(user.firstName);
    expect(html).toContain(`${events.length} events`);
  });

  it("escapes HTML-sensitive characters in the user's name", () => {
    const dataset = generate({ seed: 2, scaleFactor: 20 });
    const user = { ...dataset.users[0], firstName: `<script>alert(1)</script>` };
    const events = buildUserJourney(dataset, dataset.users[0].id);
    const html = renderJourneyHtml(user, events);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
