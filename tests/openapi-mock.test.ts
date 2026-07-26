import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  openApiPathToExpressPath,
  resolveExampleRoutes,
  loadOpenApiExampleDoc,
  createOpenApiExampleServer,
  type OpenApiExampleDoc,
} from "../src/openapi-mock.js";

function withServer(app: ReturnType<typeof createOpenApiExampleServer>) {
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

const SPEC: OpenApiExampleDoc = {
  paths: {
    "/widgets": {
      get: {
        responses: {
          "200": { content: { "application/json": { example: [{ id: "w1", name: "Blue Widget" }] } } },
        },
      },
      post: {
        responses: {
          "201": {
            content: {
              "application/json": {
                examples: {
                  zCreated: { value: { id: "w9", name: "Should not win" } },
                  aCreated: { value: { id: "w0", name: "Alphabetically first" } },
                },
              },
            },
          },
        },
      },
    },
    "/widgets/{id}": {
      get: {
        responses: {
          "200": { content: { "application/json": { schema: { example: { id: "w1", name: "Blue Widget" } } } } },
          "404": { content: { "application/json": { example: { error: "not found" } } } },
        },
      },
    },
    // Deliberately a static sibling of the /widgets/{id} param route above --
    // a real bug (Express registering the param route first silently
    // swallows this one) was caught by actually running a server and
    // requesting this exact path, not by reading the registration code.
    "/widgets/no-example": {
      get: {
        responses: {
          "200": { content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
  },
};

describe("openApiPathToExpressPath", () => {
  it("converts every {param} to :param, including multiple in one path", () => {
    expect(openApiPathToExpressPath("/orders/{id}")).toBe("/orders/:id");
    expect(openApiPathToExpressPath("/orders/{orderId}/items/{itemId}")).toBe("/orders/:orderId/items/:itemId");
    expect(openApiPathToExpressPath("/widgets")).toBe("/widgets");
  });
});

describe("resolveExampleRoutes", () => {
  it("resolves a single `example` field", () => {
    const routes = resolveExampleRoutes(SPEC);
    const widgetsGet = routes.find((r) => r.method === "get" && r.specPath === "/widgets");
    expect(widgetsGet?.statusCode).toBe(200);
    expect(widgetsGet?.body).toEqual([{ id: "w1", name: "Blue Widget" }]);
  });

  it("resolves an `examples` map to the alphabetically-first key, deterministically", () => {
    const routes = resolveExampleRoutes(SPEC);
    const widgetsPost = routes.find((r) => r.method === "post" && r.specPath === "/widgets");
    expect(widgetsPost?.body).toEqual({ id: "w0", name: "Alphabetically first" });
  });

  it("falls back to schema.example when no example/examples is present", () => {
    const routes = resolveExampleRoutes(SPEC);
    const widgetById = routes.find((r) => r.method === "get" && r.specPath === "/widgets/{id}");
    expect(widgetById?.body).toEqual({ id: "w1", name: "Blue Widget" });
  });

  it("prefers the lowest declared 2xx over other declared codes for the same operation", () => {
    // /widgets/{id} declares both 200 (schema.example) and 404 (example) --
    // 200 should win since it's the lowest 2xx.
    const routes = resolveExampleRoutes(SPEC);
    const widgetById = routes.find((r) => r.method === "get" && r.specPath === "/widgets/{id}");
    expect(widgetById?.statusCode).toBe(200);
  });

  it("omits operations with no example anywhere, rather than fabricating one", () => {
    const routes = resolveExampleRoutes(SPEC);
    expect(routes.find((r) => r.specPath === "/widgets/no-example")).toBeUndefined();
  });
});

describe("createOpenApiExampleServer (real Express app, real requests)", () => {
  it("serves the resolved example verbatim with its resolved status code", async () => {
    const app = createOpenApiExampleServer(SPEC);
    const { port, close } = await withServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/widgets`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([{ id: "w1", name: "Blue Widget" }]);
    } finally {
      close();
    }
  });

  it("a static sibling of a param route is NOT swallowed by the param route -- the real bug this project caught by running a server, not by reading code", async () => {
    const app = createOpenApiExampleServer(SPEC);
    const { port, close } = await withServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/widgets/no-example`);
      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.error).toMatch(/no example\/examples\/schema\.example/);
    } finally {
      close();
    }
  });

  it("the param route still matches a real id once the static sibling is excluded", async () => {
    const app = createOpenApiExampleServer(SPEC);
    const { port, close } = await withServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/widgets/w1`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "w1", name: "Blue Widget" });
    } finally {
      close();
    }
  });

  it("a path/method not in the spec at all gets a 404, distinct from the 501 for a declared-but-example-less route", async () => {
    const app = createOpenApiExampleServer(SPEC);
    const { port, close } = await withServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/not-in-spec`);
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });

  it("reuses serve's real authMiddleware -- no header and wrong key both 401, correct key succeeds", async () => {
    const app = createOpenApiExampleServer(SPEC, { apiKey: "secret" });
    const { port, close } = await withServer(app);
    try {
      const noAuth = await fetch(`http://127.0.0.1:${port}/widgets`);
      const wrongKey = await fetch(`http://127.0.0.1:${port}/widgets`, { headers: { Authorization: "Bearer wrong" } });
      const correctKey = await fetch(`http://127.0.0.1:${port}/widgets`, { headers: { Authorization: "Bearer secret" } });
      expect(noAuth.status).toBe(401);
      expect(wrongKey.status).toBe(401);
      expect(correctKey.status).toBe(200);
    } finally {
      close();
    }
  });

  it("the root route reports real routesWithExamples/routesWithoutExamples, not a hardcoded list", async () => {
    const app = createOpenApiExampleServer(SPEC);
    const { port, close } = await withServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      const body = await res.json();
      expect(body.routesWithExamples).toContain("GET /widgets");
      expect(body.routesWithoutExamples).toContain("GET /widgets/no-example");
    } finally {
      close();
    }
  });
});

describe("loadOpenApiExampleDoc", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "eco-openapi-mock-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a real local .json file", async () => {
    const p = path.join(dir, "spec.json");
    writeFileSync(p, JSON.stringify(SPEC), "utf-8");
    const doc = await loadOpenApiExampleDoc(p);
    expect(doc.paths?.["/widgets"]).toBeDefined();
  });

  it("loads a real local .yaml file", async () => {
    const p = path.join(dir, "spec.yaml");
    writeFileSync(
      p,
      [
        "paths:",
        "  /ping:",
        "    get:",
        "      responses:",
        '        "200":',
        "          content:",
        "            application/json:",
        "              example:",
        "                status: ok",
        "",
      ].join("\n"),
      "utf-8"
    );
    const doc = await loadOpenApiExampleDoc(p);
    const routes = resolveExampleRoutes(doc);
    expect(routes.find((r) => r.specPath === "/ping")?.body).toEqual({ status: "ok" });
  });

  it("throws a clear error for a missing file rather than an uncaught exception with no context", async () => {
    await expect(loadOpenApiExampleDoc(path.join(dir, "nope.json"))).rejects.toThrow(/ENOENT|no such file/i);
  });

  it("throws a clear parse error for malformed JSON", async () => {
    const p = path.join(dir, "bad.json");
    writeFileSync(p, "{ not: valid json", "utf-8");
    await expect(loadOpenApiExampleDoc(p)).rejects.toThrow(/Could not parse/);
  });
});
