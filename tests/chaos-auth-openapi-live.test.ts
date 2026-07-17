import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import WebSocket from "ws";
import { generate } from "../src/generator.js";
import { createMockApiServer, DEFAULT_CHAOS_OPTIONS } from "../src/serve.js";
import { buildOpenApiSpec } from "../src/openapi.js";
import { attachLiveFeed } from "../src/live.js";

const dataset = generate({ seed: 1, scaleFactor: 60 });

function withServer(app: ReturnType<typeof createMockApiServer>) {
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

describe("chaos mode", () => {
  it("with errorRate=1, every /api/* request gets a simulated 500", async () => {
    const app = createMockApiServer(dataset, { chaos: { ...DEFAULT_CHAOS_OPTIONS, errorRate: 1, rateLimitRate: 0, latencyRate: 0 } });
    const { port, close } = await withServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/users`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/simulated chaos/i);
    } finally {
      close();
    }
  });

  it("with rateLimitRate=1, every /api/* request gets a simulated 429 with Retry-After", async () => {
    const app = createMockApiServer(dataset, { chaos: { ...DEFAULT_CHAOS_OPTIONS, rateLimitRate: 1, errorRate: 0, latencyRate: 0 } });
    const { port, close } = await withServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/orders`);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBeTruthy();
    } finally {
      close();
    }
  });

  it("without chaos enabled, requests are unaffected", async () => {
    const app = createMockApiServer(dataset);
    const { port, close } = await withServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/users`);
      expect(res.status).toBe(200);
    } finally {
      close();
    }
  });

  it("chaos does not apply to / or /openapi.json", async () => {
    const app = createMockApiServer(dataset, { chaos: { ...DEFAULT_CHAOS_OPTIONS, errorRate: 1, rateLimitRate: 0, latencyRate: 0 } });
    const { port, close } = await withServer(app);
    try {
      const root = await fetch(`http://127.0.0.1:${port}/`);
      const openapi = await fetch(`http://127.0.0.1:${port}/openapi.json`);
      expect(root.status).toBe(200);
      expect(openapi.status).toBe(200);
    } finally {
      close();
    }
  });
});

describe("API key auth", () => {
  it("rejects requests without a matching Authorization header", async () => {
    const app = createMockApiServer(dataset, { apiKey: "secret" });
    const { port, close } = await withServer(app);
    try {
      const noAuth = await fetch(`http://127.0.0.1:${port}/api/orders`);
      const wrongKey = await fetch(`http://127.0.0.1:${port}/api/orders`, { headers: { Authorization: "Bearer wrong" } });
      const correctKey = await fetch(`http://127.0.0.1:${port}/api/orders`, { headers: { Authorization: "Bearer secret" } });
      expect(noAuth.status).toBe(401);
      expect(wrongKey.status).toBe(401);
      expect(correctKey.status).toBe(200);
    } finally {
      close();
    }
  });

  it("does not gate / or /openapi.json", async () => {
    const app = createMockApiServer(dataset, { apiKey: "secret" });
    const { port, close } = await withServer(app);
    try {
      const root = await fetch(`http://127.0.0.1:${port}/`);
      const openapi = await fetch(`http://127.0.0.1:${port}/openapi.json`);
      expect(root.status).toBe(200);
      expect(openapi.status).toBe(200);
    } finally {
      close();
    }
  });
});

describe("OpenAPI spec", () => {
  it("describes all six resources with list and item paths", () => {
    const spec = buildOpenApiSpec(dataset, 4000) as any;
    const routes = ["users", "carts", "abandoned-checkouts", "orders", "shipments", "returns"];
    for (const route of routes) {
      expect(spec.paths[`/api/${route}`]).toBeDefined();
      expect(spec.paths[`/api/${route}/{id}`]).toBeDefined();
    }
  });

  it("every $ref points at a schema that actually exists", () => {
    const spec = buildOpenApiSpec(dataset, 4000) as any;
    const schemaNames = new Set(Object.keys(spec.components.schemas));
    const refs: string[] = [];
    (function walk(obj: unknown) {
      if (Array.isArray(obj)) return obj.forEach(walk);
      if (obj && typeof obj === "object") {
        const rec = obj as Record<string, unknown>;
        if (typeof rec["$ref"] === "string") refs.push(rec["$ref"] as string);
        Object.values(rec).forEach(walk);
      }
    })(spec);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref.replace("#/components/schemas/", "");
      expect(schemaNames.has(name), `broken $ref: ${ref}`).toBe(true);
    }
  });
});

describe("live WebSocket feed", () => {
  it("broadcasts chronologically-shaped events to connected clients", async () => {
    const httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;

    attachLiveFeed(httpServer, { seed: 1, scaleFactor: 50 }, Date.parse("2026-01-01T00:00:00Z"), { intervalMs: 20 });

    const received: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
      const timeout = setTimeout(() => reject(new Error("timed out waiting for live events")), 3000);
      ws.on("message", (data) => {
        received.push(JSON.parse(data.toString()));
        if (received.length >= 4) {
          clearTimeout(timeout);
          ws.close();
          httpServer.close();
          resolve();
        }
      });
      ws.on("error", reject);
    });

    expect(received[0].type).toBe("_meta");
    expect(received.slice(1).every((e) => typeof e.type === "string" && typeof e.timestamp === "string")).toBe(true);
  });
});
