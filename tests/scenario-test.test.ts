import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runScenarioTest, resolveDotPath, substituteTemplates, validateScenario, type Scenario } from "../src/scenario-test.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("resolveDotPath", () => {
  it("resolves nested object paths", () => {
    expect(resolveDotPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("resolves array indices as path segments", () => {
    expect(resolveDotPath({ users: [{ id: "u1" }, { id: "u2" }] }, "users.1.id")).toBe("u2");
  });

  it("returns undefined for a path that doesn't exist, rather than throwing", () => {
    expect(resolveDotPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(resolveDotPath(null, "a.b")).toBeUndefined();
    expect(resolveDotPath(undefined, "a")).toBeUndefined();
  });

  it("returns the object itself for an empty path", () => {
    const obj = { a: 1 };
    expect(resolveDotPath(obj, "")).toBe(obj);
  });
});

describe("substituteTemplates", () => {
  it("substitutes a real value from the given scope", () => {
    const unresolved = new Set<string>();
    const result = substituteTemplates("/orders/{{checkout.orderId}}/ship", { checkout: { orderId: "abc-123" } }, unresolved);
    expect(result).toBe("/orders/abc-123/ship");
    expect(unresolved.size).toBe(0);
  });

  it("leaves an unresolvable placeholder exactly as written and reports it, rather than substituting the string 'undefined'", () => {
    const unresolved = new Set<string>();
    const result = substituteTemplates("/orders/{{checkout.orderId}}", {}, unresolved);
    expect(result).toBe("/orders/{{checkout.orderId}}");
    expect(unresolved.has("{{checkout.orderId}}")).toBe(true);
  });

  it("substitutes multiple placeholders in one string", () => {
    const unresolved = new Set<string>();
    const result = substituteTemplates("{{a.x}}-{{b.y}}", { a: { x: "1" }, b: { y: "2" } }, unresolved);
    expect(result).toBe("1-2");
  });
});

describe("validateScenario", () => {
  it("accepts a well-formed scenario with no errors", () => {
    const scenario: Scenario = { name: "test", steps: [{ name: "s1", method: "POST", path: "/x" }] };
    expect(validateScenario(scenario)).toEqual([]);
  });

  it("rejects a missing name", () => {
    const errors = validateScenario({ steps: [{ name: "s1", method: "GET", path: "/x" }] });
    expect(errors.some((e) => e.includes('"name"'))).toBe(true);
  });

  it("rejects an empty or missing steps array", () => {
    expect(validateScenario({ name: "test", steps: [] }).some((e) => e.includes("steps"))).toBe(true);
    expect(validateScenario({ name: "test" }).some((e) => e.includes("steps"))).toBe(true);
  });

  it("rejects duplicate step names -- later steps reference earlier ones by name, so ambiguity here is a real authoring bug", () => {
    const errors = validateScenario({
      name: "test",
      steps: [
        { name: "dup", method: "GET", path: "/a" },
        { name: "dup", method: "GET", path: "/b" },
      ],
    });
    expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("reports each step missing a method or path individually", () => {
    const errors = validateScenario({ name: "test", steps: [{ name: "s1" }] });
    expect(errors.some((e) => e.includes("method"))).toBe(true);
    expect(errors.some((e) => e.includes("path"))).toBe(true);
  });
});

/** The exact five-step lifecycle from the original spec this feature was built against: cart -> checkout -> ship -> illegal cancel (expect rejection) -> return. */
function buildLifecycleScenario(overrides: Partial<Record<string, unknown>> = {}): Scenario {
  return {
    name: "full-lifecycle",
    steps: [
      { name: "createCart", method: "POST", path: "/carts", body: { userId: "u1" }, expectStatus: 201, capture: { cartId: "id" } },
      {
        name: "checkout",
        method: "POST",
        path: "/carts/{{createCart.cartId}}/checkout",
        expectStatus: 201,
        expectBody: { status: "processing" },
        capture: { orderId: "id" },
      },
      { name: "ship", method: "POST", path: "/orders/{{checkout.orderId}}/ship", expectStatus: 200, expectBody: { status: "shipped" } },
      { name: "illegalCancel", method: "POST", path: "/orders/{{checkout.orderId}}/cancel", expectStatus: 409 },
      {
        name: "requestReturn",
        method: "POST",
        path: "/orders/{{checkout.orderId}}/return",
        expectStatus: 200,
        expectBody: { status: "returning" },
        ...overrides,
      },
    ],
  };
}

/** A real, small in-memory backend implementing the lifecycle correctly. */
function buildCompliantLifecycleServer() {
  const orders = new Map<string, { id: string; status: string }>();
  const fetchImpl: typeof fetch = (async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname === "/carts" && method === "POST") return jsonResponse({ id: randomUUID(), status: "active" }, 201);

    let m = url.pathname.match(/^\/carts\/([^/]+)\/checkout$/);
    if (m && method === "POST") {
      const id = randomUUID();
      orders.set(id, { id, status: "processing" });
      return jsonResponse({ id, status: "processing" }, 201);
    }

    m = url.pathname.match(/^\/orders\/([^/]+)\/ship$/);
    if (m && method === "POST") {
      const order = orders.get(m[1]);
      if (!order) return jsonResponse({ error: "not found" }, 404);
      order.status = "shipped";
      return jsonResponse({ id: order.id, status: "shipped" }, 200);
    }

    m = url.pathname.match(/^\/orders\/([^/]+)\/cancel$/);
    if (m && method === "POST") {
      const order = orders.get(m[1]);
      if (!order) return jsonResponse({ error: "not found" }, 404);
      if (order.status === "shipped") return jsonResponse({ error: "cannot cancel a shipped order" }, 409);
      order.status = "cancelled";
      return jsonResponse({ id: order.id, status: "cancelled" }, 200);
    }

    m = url.pathname.match(/^\/orders\/([^/]+)\/return$/);
    if (m && method === "POST") {
      const order = orders.get(m[1]);
      if (!order) return jsonResponse({ error: "not found" }, 404);
      order.status = "returning";
      return jsonResponse({ id: order.id, status: "returning" }, 200);
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  return { fetchImpl };
}

/** The same server, but with the one real bug this engine is meant to catch: it wrongly allows cancelling an order that's already shipped. */
function buildBuggyLifecycleServer() {
  const orders = new Map<string, { id: string; status: string }>();
  const fetchImpl: typeof fetch = (async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname === "/carts" && method === "POST") return jsonResponse({ id: randomUUID(), status: "active" }, 201);

    let m = url.pathname.match(/^\/carts\/([^/]+)\/checkout$/);
    if (m && method === "POST") {
      const id = randomUUID();
      orders.set(id, { id, status: "processing" });
      return jsonResponse({ id, status: "processing" }, 201);
    }

    m = url.pathname.match(/^\/orders\/([^/]+)\/ship$/);
    if (m && method === "POST") {
      const order = orders.get(m[1]);
      if (!order) return jsonResponse({ error: "not found" }, 404);
      order.status = "shipped";
      return jsonResponse({ id: order.id, status: "shipped" }, 200);
    }

    // BUG: never checks the order's current status at all.
    m = url.pathname.match(/^\/orders\/([^/]+)\/cancel$/);
    if (m && method === "POST") {
      const order = orders.get(m[1]);
      if (!order) return jsonResponse({ error: "not found" }, 404);
      order.status = "cancelled";
      return jsonResponse({ id: order.id, status: "cancelled" }, 200);
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  return { fetchImpl };
}

describe("runScenarioTest", () => {
  it("passes every step of the real five-step lifecycle against a correctly-implemented server, threading real captured ids through each step", async () => {
    const { fetchImpl } = buildCompliantLifecycleServer();
    const result = await runScenarioTest({ baseUrl: "http://localhost", scenario: buildLifecycleScenario(), fetchImpl });
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(5);
    expect(result.stoppedEarly).toBe(false);
    // Every step after createCart used a real, non-templated id -- not a literal "{{...}}" left unresolved.
    for (const step of result.steps.slice(1)) {
      expect(step.requestPath).not.toContain("{{");
    }
  });

  it("catches the real illegal-cancel-after-shipment bug and stops before the now-meaningless return step", async () => {
    const { fetchImpl } = buildBuggyLifecycleServer();
    const result = await runScenarioTest({ baseUrl: "http://localhost", scenario: buildLifecycleScenario(), fetchImpl });
    expect(result.failed).toBe(1);
    expect(result.stoppedEarly).toBe(true);
    const failedStep = result.steps.find((s) => !s.ok)!;
    expect(failedStep.step).toBe("illegalCancel");
    expect(failedStep.statusActual).toBe(200);
    expect(failedStep.statusExpected).toEqual([409]);
    // requestReturn never ran -- the scenario correctly stopped rather than
    // continuing to test against a server already in a broken state.
    expect(result.steps.find((s) => s.step === "requestReturn")).toBeUndefined();
  });

  it("catches a business-logic mismatch even when the status code is 'correct' -- expectBody catches what expectStatus alone can't", async () => {
    const fetchImpl: typeof fetch = (async () => jsonResponse({ id: "o1", status: "processing" }, 200)) as typeof fetch; // ship "succeeds" but never actually changes status
    const scenario: Scenario = {
      name: "status-mismatch",
      steps: [{ name: "ship", method: "POST", path: "/orders/o1/ship", expectStatus: 200, expectBody: { status: "shipped" } }],
    };
    const result = await runScenarioTest({ baseUrl: "http://localhost", scenario, fetchImpl });
    expect(result.failed).toBe(1);
    expect(result.steps[0].bodyMismatches).toBeDefined();
    expect(result.steps[0].bodyMismatches![0]).toContain("status");
  });

  it("uses seedVariables for a real value from an eco-faker dataset, e.g. a real user id", async () => {
    let capturedBody: unknown;
    const fetchImpl: typeof fetch = (async (_input, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return jsonResponse({ id: "c1" }, 201);
    }) as typeof fetch;

    const scenario: Scenario = {
      name: "seed-test",
      steps: [{ name: "createCart", method: "POST", path: "/carts", body: { userId: "{{seed.users.0.id}}" }, expectStatus: 201 }],
    };
    await runScenarioTest({
      baseUrl: "http://localhost",
      scenario,
      fetchImpl,
      seedVariables: { users: [{ id: "real-user-id-42" }] },
    });
    expect((capturedBody as { userId: string }).userId).toBe("real-user-id-42");
  });

  it("reports an unresolved placeholder as a specific, visible failure rather than a confusing downstream 404", async () => {
    const fetchImpl: typeof fetch = (async () => jsonResponse({ id: "x" }, 201)) as typeof fetch;
    const scenario: Scenario = {
      name: "typo-test",
      steps: [
        { name: "createCart", method: "POST", path: "/carts", expectStatus: 201, capture: { cartId: "id" } },
        { name: "checkout", method: "POST", path: "/carts/{{createCrat.cartId}}/checkout", expectStatus: 201 }, // typo: createCrat
      ],
    };
    const result = await runScenarioTest({ baseUrl: "http://localhost", scenario, fetchImpl });
    expect(result.steps[1].ok).toBe(false);
    expect(result.steps[1].unresolvedPlaceholders).toEqual(["{{createCrat.cartId}}"]);
  });

  it("reports a real network failure distinctly from a failed assertion, and stops the scenario", async () => {
    const fetchImpl: typeof fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const scenario: Scenario = { name: "network-fail", steps: [{ name: "s1", method: "GET", path: "/x" }] };
    const result = await runScenarioTest({ baseUrl: "http://localhost", scenario, fetchImpl });
    expect(result.steps[0].ok).toBe(false);
    expect(result.steps[0].error).toContain("ECONNREFUSED");
    expect(result.stoppedEarly).toBe(true);
  });

  it("defaults to accepting any 2xx when a step doesn't declare expectStatus", async () => {
    const fetchImpl: typeof fetch = (async () => jsonResponse({}, 202)) as typeof fetch;
    const scenario: Scenario = { name: "default-status", steps: [{ name: "s1", method: "POST", path: "/x" }] };
    const result = await runScenarioTest({ baseUrl: "http://localhost", scenario, fetchImpl });
    expect(result.steps[0].ok).toBe(true);
  });
});
