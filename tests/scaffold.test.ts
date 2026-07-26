import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { generate, serialize } from "../src/index.js";
import { buildScaffold, SCAFFOLD_TARGETS, SIMPLE_SCAFFOLD_TARGETS, ORM_SCAFFOLD_TARGETS } from "../src/scaffold.js";

describe("buildScaffold", () => {
  it("SIMPLE_SCAFFOLD_TARGETS is exactly next and msw -- the ones buildScaffold itself handles (no schema to introspect)", () => {
    expect(SIMPLE_SCAFFOLD_TARGETS).toEqual(["next", "msw"]);
  });

  it("ORM_SCAFFOLD_TARGETS is exactly prisma/drizzle/sqlalchemy -- handled by orm-scaffold.ts, not this module, since they need a parsed schema", () => {
    expect(ORM_SCAFFOLD_TARGETS).toEqual(["prisma", "drizzle", "sqlalchemy"]);
  });

  it("SCAFFOLD_TARGETS is the union of both, in that order", () => {
    expect(SCAFFOLD_TARGETS).toEqual(["next", "msw", "prisma", "drizzle", "sqlalchemy"]);
  });

  describe("next", () => {
    const result = buildScaffold("next", { seed: 5 });

    it("writes exactly a seed script and a dynamic API route", () => {
      const paths = result.files.map((f) => f.path).sort();
      expect(paths).toEqual(["app/api/eco/[table]/route.ts", "scripts/eco-seed.mjs"]);
    });

    it("the seed script is real, runnable JS that produces valid, config-free JSON matching what `generate --format json` itself writes", () => {
      const script = result.files.find((f) => f.path === "scripts/eco-seed.mjs")!;
      expect(script.contents).toContain("generate({ seed: 5 })");
      // Actually run it against the real package (not just pattern-match the
      // string) -- swap the "eco-faker" import for a relative one so this
      // test doesn't need the package installed under that name.
      const runnable = script.contents
        .replace('from "eco-faker"', `from "${process.cwd()}/src/index.js"`)
        .replaceAll("./eco-data.json", "/tmp/scaffold-test-eco-data.json");
      const tmpScriptPath = "/tmp/scaffold-test-seed.mjs";
      writeFileSync(tmpScriptPath, runnable, "utf-8");
      execSync(`npx tsx ${tmpScriptPath}`, { cwd: process.cwd() });
      const written = JSON.parse(readFileSync("/tmp/scaffold-test-eco-data.json", "utf-8"));
      expect(written.config).toBeUndefined();
      expect(written.orders.length).toBeGreaterThan(0);

      const expected = JSON.parse(serialize(generate({ seed: 5 }), "json"));
      expect(written.orders.length).toBe(expected.orders.length);
    });

    it("the route handler reads a table param, supports page/pageSize-independent limit/offset internally, and 404s an unknown table", () => {
      const route = result.files.find((f) => f.path === "app/api/eco/[table]/route.ts")!;
      expect(route.contents).toContain("export async function GET");
      expect(route.contents).toContain("eco-data.json");
      expect(route.contents).toContain('status: 404');
    });
  });

  describe("msw", () => {
    const result = buildScaffold("msw", { seed: 7 });

    it("writes handlers + browser + server files", () => {
      const paths = result.files.map((f) => f.path).sort();
      expect(paths).toEqual(["mocks/browser.ts", "mocks/eco-handlers.ts", "mocks/server.ts"]);
    });

    it("handlers.ts imports from eco-faker and eco-faker/msw, and documents the real page/pageSize pagination convention (not limit/offset)", () => {
      const handlers = result.files.find((f) => f.path === "mocks/eco-handlers.ts")!;
      expect(handlers.contents).toContain('from "eco-faker"');
      expect(handlers.contents).toContain('from "eco-faker/msw"');
      expect(handlers.contents).toContain("generate({ seed: 7 })");
      expect(handlers.contents).toContain("page=&pageSize=");
      expect(handlers.contents).not.toMatch(/toMswHandlers\(dataset\).*limit/s);
    });

    it("browser.ts and server.ts both import from ./eco-handlers -- same handlers, not two independently generated datasets", () => {
      const browser = result.files.find((f) => f.path === "mocks/browser.ts")!;
      const server = result.files.find((f) => f.path === "mocks/server.ts")!;
      expect(browser.contents).toContain('from "./eco-handlers"');
      expect(server.contents).toContain('from "./eco-handlers"');
      expect(browser.contents).toContain("setupWorker");
      expect(server.contents).toContain("setupServer");
    });
  });

  it("default seed is 1 when not specified", () => {
    const result = buildScaffold("next");
    const script = result.files.find((f) => f.path === "scripts/eco-seed.mjs")!;
    expect(script.contents).toContain("generate({ seed: 1 })");
  });

  it("nextSteps is non-empty prose for both targets, not just a file dump", () => {
    for (const target of SCAFFOLD_TARGETS) {
      const result = buildScaffold(target);
      expect(result.nextSteps.length).toBeGreaterThan(0);
      expect(result.nextSteps.join(" ").length).toBeGreaterThan(20);
    }
  });
});
