import { describe, expect, it } from "vitest";
import { parseFeature, GherkinParseError } from "../src/gherkin.js";
import { runScenarioTest } from "../src/scenario-test.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("parseFeature", () => {
  it("parses a Feature name and a single Scenario with a plain GET step", () => {
    const result = parseFeature(`Feature: Orders API\n\n  Scenario: List orders\n    Given I GET "/api/orders"\n`);
    expect(result.featureName).toBe("Orders API");
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].name).toBe("List orders");
    expect(result.scenarios[0].steps).toEqual([{ name: "step 1", method: "GET", path: "/api/orders", body: undefined }]);
  });

  it("auto-names steps sequentially when no 'and call it' is given", () => {
    const result = parseFeature(`Feature: F\nScenario: S\nGiven I GET "/a"\nWhen I GET "/b"\n`);
    expect(result.scenarios[0].steps.map((s) => s.name)).toEqual(["step 1", "step 2"]);
  });

  it("uses a custom step name from 'and call it'", () => {
    const result = parseFeature(`Feature: F\nScenario: S\nGiven I GET "/api/orders" and call it "listOrders"\n`);
    expect(result.scenarios[0].steps[0].name).toBe("listOrders");
  });

  it("parses a request body, correctly distinguishing it from a trailing 'and call it' clause on the same line", () => {
    const result = parseFeature(`Feature: F\nScenario: S\nWhen I POST "/api/orders" with body {"userId": 1, "total": 12.5} and call it "createOrder"\n`);
    const step = result.scenarios[0].steps[0];
    expect(step.name).toBe("createOrder");
    expect(step.method).toBe("POST");
    expect(step.body).toEqual({ userId: 1, total: 12.5 });
  });

  it("parses a request body with no trailing 'and call it'", () => {
    const result = parseFeature(`Feature: F\nScenario: S\nWhen I PUT "/api/orders/1" with body {"status": "shipped"}\n`);
    expect(result.scenarios[0].steps[0].body).toEqual({ status: "shipped" });
  });

  it("attaches 'the response status should be N' to the immediately preceding request step", () => {
    const result = parseFeature(`Feature: F\nScenario: S\nGiven I GET "/a"\nThen the response status should be 404\n`);
    expect(result.scenarios[0].steps[0].expectStatus).toBe(404);
  });

  it("attaches 'the response field ... should be ...' as expectBody, parsed as real JSON values (string/number/boolean/null)", () => {
    const result = parseFeature(
      [
        "Feature: F",
        "Scenario: S",
        'Given I GET "/a"',
        'Then the response field "data.status" should be "delivered"',
        'And the response field "data.total" should be 129.99',
        'And the response field "data.active" should be true',
        'And the response field "data.deletedAt" should be null',
      ].join("\n")
    );
    expect(result.scenarios[0].steps[0].expectBody).toEqual({
      "data.status": "delivered",
      "data.total": 129.99,
      "data.active": true,
      "data.deletedAt": null,
    });
  });

  it("attaches 'I capture ... as ...' as a capture entry on the preceding step", () => {
    const result = parseFeature(`Feature: F\nScenario: S\nGiven I GET "/a"\nAnd I capture "data.id" as "orderId"\n`);
    expect(result.scenarios[0].steps[0].capture).toEqual({ orderId: "data.id" });
  });

  it("supports multiple Scenario: blocks in one Feature file, each with its own independent steps", () => {
    const result = parseFeature(
      ["Feature: F", "Scenario: First", 'Given I GET "/a"', "Scenario: Second", 'Given I DELETE "/b"', "Then the response status should be 404"].join("\n")
    );
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].steps).toHaveLength(1);
    expect(result.scenarios[1].steps[0].expectStatus).toBe(404);
    // Confirms per-scenario state (autoStepCounter, "current step" for
    // Then/And attachment) resets between scenarios rather than leaking
    // from the first into the second.
    expect(result.scenarios[1].steps[0].name).toBe("step 1");
  });

  it("ignores comments and blank lines", () => {
    const result = parseFeature(`Feature: F\n\n# a comment\nScenario: S\n\n  # another comment\nGiven I GET "/a"\n`);
    expect(result.scenarios[0].steps).toHaveLength(1);
  });

  it("all four Given/When/Then/And keywords (and But) work identically as step prefixes", () => {
    const result = parseFeature(`Feature: F\nScenario: S\nGiven I GET "/a"\nBut the response status should be 200\n`);
    expect(result.scenarios[0].steps[0].expectStatus).toBe(200);
  });
});

describe("parseFeature -- rejected syntax (clear errors, not silent misparses)", () => {
  it("rejects tags", () => {
    expect(() => parseFeature(`Feature: F\n@smoke\nScenario: S\nGiven I GET "/a"\n`)).toThrow(GherkinParseError);
  });

  it("rejects Background:", () => {
    expect(() => parseFeature(`Feature: F\nBackground:\nScenario: S\nGiven I GET "/a"\n`)).toThrow(/Background/);
  });

  it("rejects Scenario Outline:", () => {
    expect(() => parseFeature(`Feature: F\nScenario Outline: S\nExamples:\n`)).toThrow(/Scenario Outline/);
  });

  it("rejects data tables", () => {
    expect(() => parseFeature(`Feature: F\nScenario: S\nGiven I GET "/a"\n|a|b|\n`)).toThrow(/data table/);
  });

  it("rejects an unrecognized step with the full supported vocabulary listed", () => {
    expect(() => parseFeature(`Feature: F\nScenario: S\nGiven the moon is made of cheese\n`)).toThrow(/unrecognized step text/);
  });

  it("rejects 'the response status should be...' with no preceding request step", () => {
    expect(() => parseFeature(`Feature: F\nScenario: S\nThen the response status should be 200\n`)).toThrow(/no preceding request step/);
  });

  it("rejects 'the response field...' with no preceding request step", () => {
    expect(() => parseFeature(`Feature: F\nScenario: S\nThen the response field "a" should be 1\n`)).toThrow(/no preceding request step/);
  });

  it("rejects 'I capture...' with no preceding request step", () => {
    expect(() => parseFeature(`Feature: F\nScenario: S\nGiven I capture "a" as "b"\n`)).toThrow(/no preceding request step/);
  });

  it("rejects a step line before any Scenario:", () => {
    expect(() => parseFeature(`Feature: F\nGiven I GET "/a"\n`)).toThrow(/before any "Scenario:"/);
  });

  it("rejects a feature file with no Scenario: at all", () => {
    expect(() => parseFeature(`Feature: F only\n`)).toThrow(/No "Scenario:" found/);
  });

  it("rejects a Scenario with no request steps", () => {
    expect(() => parseFeature(`Feature: F\nScenario: Empty\n`)).toThrow(/has no request steps/);
  });

  it("rejects malformed JSON in a request body with a specific, actionable message", () => {
    expect(() => parseFeature(`Feature: F\nScenario: S\nWhen I POST "/a" with body {not valid json}\n`)).toThrow(/Couldn't parse.*as JSON/);
  });

  it("rejects an unparseable expected field value", () => {
    expect(() => parseFeature(`Feature: F\nScenario: S\nGiven I GET "/a"\nThen the response field "x" should be not_quoted_and_not_json\n`)).toThrow(
      /Couldn't parse/
    );
  });
});

describe("a parsed Gherkin scenario actually runs correctly through the real runScenarioTest engine", () => {
  it("a passing scenario reports 0 failures against a real (mocked) HTTP response", async () => {
    const { scenarios } = parseFeature(
      [
        "Feature: F",
        "Scenario: Fetch order",
        'Given I GET "/api/orders/{{seed.orderId}}" and call it "fetchOrder"',
        "Then the response status should be 200",
        'And the response field "data.status" should be "delivered"',
        'And I capture "data.id" as "capturedId"',
      ].join("\n")
    );

    const fetchImpl = (async (url: string) => {
      expect(url).toContain("/api/orders/real-order-42");
      return jsonResponse({ data: { id: "real-order-42", status: "delivered" } });
    }) as typeof fetch;

    const result = await runScenarioTest({
      baseUrl: "http://example.test",
      scenario: scenarios[0],
      seedVariables: { orderId: "real-order-42" },
      fetchImpl,
    });

    expect(result.failed).toBe(0);
    expect(result.passed).toBe(1);
  });

  it("a failing assertion (wrong expected status) is reported as a real failure, not silently passed", async () => {
    const { scenarios } = parseFeature(`Feature: F\nScenario: S\nGiven I GET "/api/orders/1"\nThen the response status should be 999\n`);
    const fetchImpl = (async () => jsonResponse({ ok: true }, 200)) as typeof fetch;
    const result = await runScenarioTest({ baseUrl: "http://example.test", scenario: scenarios[0], fetchImpl });
    expect(result.failed).toBe(1);
    expect(result.steps[0].bodyMismatches ?? []).toEqual([]);
    expect(result.steps[0].statusActual).toBe(200);
    expect(result.steps[0].statusExpected).toEqual([999]);
  });

  it("a failing field assertion is reported with the real actual vs expected values", async () => {
    const { scenarios } = parseFeature(`Feature: F\nScenario: S\nGiven I GET "/a"\nThen the response field "data.status" should be "shipped"\n`);
    const fetchImpl = (async () => jsonResponse({ data: { status: "delivered" } })) as typeof fetch;
    const result = await runScenarioTest({ baseUrl: "http://example.test", scenario: scenarios[0], fetchImpl });
    expect(result.failed).toBe(1);
    expect(result.steps[0].bodyMismatches).toEqual(['data.status: expected "shipped", got "delivered"']);
  });
});
