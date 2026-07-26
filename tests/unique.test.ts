import { describe, expect, it } from "vitest";
import { createUniqueTracker, UniqueRetryLimitExceededError } from "../src/unique.js";

describe("createUniqueTracker", () => {
  it("returns the first value unmodified", () => {
    const tracker = createUniqueTracker<string>();
    expect(tracker.next(() => "a")).toBe("a");
  });

  it("retries until a real, distinct value is produced on a collision", () => {
    const tracker = createUniqueTracker<string>();
    let calls = 0;
    const values = ["dup", "dup", "dup", "unique"];
    const fn = () => values[calls++];

    expect(tracker.next(fn)).toBe("dup"); // first call: no collision yet
    expect(tracker.next(fn)).toBe("unique"); // second call: "dup" collides twice, then a real distinct value wins
    expect(calls).toBe(4);
  });

  it("throws UniqueRetryLimitExceededError, not an infinite loop, when the value space is genuinely exhausted", () => {
    const tracker = createUniqueTracker<string>({ maxRetries: 5 });
    tracker.next(() => "only-possible-value");
    expect(() => tracker.next(() => "only-possible-value")).toThrow(UniqueRetryLimitExceededError);
  });

  it("respects a custom maxRetries", () => {
    const tracker = createUniqueTracker<number>({ maxRetries: 2 });
    let calls = 0;
    expect(() =>
      tracker.next(() => {
        calls++;
        return 1; // always collides after the first real call below
      })
    ).not.toThrow();
    expect(() =>
      tracker.next(() => {
        calls++;
        return 1;
      })
    ).toThrow(UniqueRetryLimitExceededError);
    expect(calls).toBe(1 + 2); // 1 successful first call + 2 failed retries of the second
  });

  it("has() and size reflect real tracked state", () => {
    const tracker = createUniqueTracker<string>();
    expect(tracker.size).toBe(0);
    tracker.next(() => "a");
    tracker.next(() => "b");
    expect(tracker.size).toBe(2);
    expect(tracker.has("a")).toBe(true);
    expect(tracker.has("z")).toBe(false);
  });

  it("two independent trackers never see each other's state -- explicit scoping, not a hidden shared registry", () => {
    const trackerA = createUniqueTracker<string>();
    const trackerB = createUniqueTracker<string>();
    expect(trackerA.next(() => "x")).toBe("x");
    expect(trackerB.next(() => "x")).toBe("x"); // no collision -- separate tracker, separate state
  });

  it("real integration: eliminates a real, previously-reproducible duplicate-email bug in generateUsers", async () => {
    const { faker } = await import("@faker-js/faker");
    const { generateUsers } = await import("../src/modules/user/index.js");
    const { Rng } = await import("../src/rng.js");

    // Seeds 3, 4, and 8 at scaleFactor 5000 produced 1-2 real duplicate
    // emails before createUniqueTracker was applied -- confirmed directly
    // against the actual (pre-fix) generateUsers before this fix existed.
    for (const seed of [3, 4, 8]) {
      faker.seed(seed);
      const rng = new Rng(seed);
      const users = generateUsers(faker, rng, { scaleFactor: 5000, historicalDays: 90, locale: "en-US" } as never, Date.now());
      const emails = users.map((u) => u.email);
      expect(new Set(emails).size, `seed ${seed} should have zero duplicate emails`).toBe(emails.length);
    }
  });
});
