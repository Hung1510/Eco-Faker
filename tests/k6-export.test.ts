import { describe, expect, it } from "vitest";
import { buildK6Script } from "../src/k6-export.js";
import { TABLE_ROUTES } from "../src/serve.js";
import type { OpenApiDocument } from "../src/contract-test.js";

function stripModuleSyntax(script: string): string {
  return script
    .replace(/^import.*$/gm, "")
    .replace(/^export default function/gm, "function __k6Default")
    .replace(/^export /gm, "");
}

describe("buildK6Script -- TABLE_ROUTES mode (default, no contract given)", () => {
  it("is valid, parseable JS (real syntax check, not just a string comparison)", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000" });
    expect(() => new Function(stripModuleSyntax(script))).not.toThrow();
  });

  it("imports the real k6/http and k6 modules", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000" });
    expect(script).toContain("import http from 'k6/http';");
    expect(script).toContain("import { check, sleep } from 'k6';");
  });

  it("includes every real route from the actual TABLE_ROUTES, not a hardcoded/stale subset", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000" });
    for (const route of Object.keys(TABLE_ROUTES)) {
      expect(script, `expected route "${route}" to appear in the generated script`).toContain(`/api/${route}`);
    }
  });

  it("uses the real vus/duration options passed in, not hardcoded defaults", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000", vus: 42, durationSeconds: 99 });
    expect(script).toContain("vus: 42");
    expect(script).toContain("duration: '99s'");
  });

  it("defaults to reasonable vus/duration when not specified", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000" });
    expect(script).toContain("vus: 10");
    expect(script).toContain("duration: '30s'");
  });

  it("embeds the given baseUrl as a real fallback, overridable via __ENV.BASE_URL", () => {
    const script = buildK6Script({ baseUrl: "http://example.test:1234" });
    expect(script).toContain("const BASE_URL = __ENV.BASE_URL || 'http://example.test:1234';");
  });

  it("includes a real Authorization header block when an apiKey is given, and omits it otherwise", () => {
    const withKey = buildK6Script({ baseUrl: "http://localhost:4000", apiKey: "sekret" });
    expect(withKey).toContain("Authorization: 'Bearer sekret'");

    const withoutKey = buildK6Script({ baseUrl: "http://localhost:4000" });
    expect(withoutKey).not.toContain("Authorization");
  });

  it("generates both a list check and a detail (get-by-id) check for every route, with a real id-discovery pattern", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000" });
    expect(script).toContain("orders: list status is 2xx");
    expect(script).toContain("orders: detail status is 2xx");
    expect(script).toContain("body.data[0].id");
  });
});

describe("buildK6Script -- OpenAPI contract mode", () => {
  const contract: OpenApiDocument = {
    paths: {
      "/widgets": { get: {} },
      "/widgets/{id}": { get: {} },
      "/health": { get: {} },
      "/widgets/{id}/reviews/{reviewId}": { get: {} }, // multiple path params -- deliberately not handled, see scope note
    },
  };

  it("derives routes from the real contract's declared GET paths, not TABLE_ROUTES", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000", contract });
    expect(script).toContain("/widgets");
    expect(script).toContain("/health");
    // Confirms this is genuinely contract-derived, not silently falling
    // back to TABLE_ROUTES -- a real TABLE_ROUTES route shouldn't appear.
    expect(script).not.toContain("/api/orders");
  });

  it("pairs a list path with its real detail sibling when one exists in the contract", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000", contract });
    expect(script).toContain("widgets: list status is 2xx");
    expect(script).toContain("widgets: detail status is 2xx");
  });

  it("a list path with no detail sibling gets only a list check, no fabricated detail block", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000", contract });
    expect(script).toContain("health: list status is 2xx");
    expect(script).not.toContain("health: detail status is 2xx");
  });

  it("a path with multiple path parameters is not treated as a list entry point at all -- documented scope limit, not a silent guess", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000", contract });
    expect(script).not.toContain("reviews");
  });

  it("a path declared without a GET operation at all is not included", () => {
    const postOnly: OpenApiDocument = { paths: { "/orders": { post: {} } } };
    const script = buildK6Script({ baseUrl: "http://localhost:4000", contract: postOnly });
    expect(script).not.toContain("/orders");
  });

  it("is valid, parseable JS in contract mode too", () => {
    const script = buildK6Script({ baseUrl: "http://localhost:4000", contract });
    expect(() => new Function(stripModuleSyntax(script))).not.toThrow();
  });
});
