import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generate } from "../src/generator.js";
import { toSql } from "../src/output/sql.js";
import { parsePrismaSchema } from "../src/introspect/prisma.js";
import { buildSchemaMapping, CANONICAL_COLUMNS } from "../src/introspect/mapper.js";
import {
  CORE_TABLES,
  tableToCamel,
  columnToCamel,
  buildPrismaSeedScript,
  buildDrizzleSeedScript,
  buildSqlAlchemySeedScript,
} from "../src/orm-scaffold.js";

const dataset = generate({ seed: 4, scaleFactor: 60 });

describe("CORE_TABLES ordering", () => {
  it("matches the real FK-dependency order output/sql.ts actually emits, not just an asserted-by-inspection copy of it", () => {
    const sql = toSql(dataset);
    const createOrder = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    const coreOrderInSql = CORE_TABLES.filter((t) => createOrder.includes(t)).sort((a, b) => createOrder.indexOf(a) - createOrder.indexOf(b));
    expect([...CORE_TABLES]).toEqual(coreOrderInSql);
  });
});

describe("tableToCamel / columnToCamel", () => {
  it("every canonical column for every core table resolves to a real field name on a real generated record", () => {
    for (const table of CORE_TABLES) {
      const camelTable = tableToCamel(table);
      const records = (dataset as unknown as Record<string, unknown[]>)[camelTable];
      expect(records, `${table} -> ${camelTable} should be a real array on the dataset`).toBeDefined();
      const record = records[0] as Record<string, unknown>;
      for (const col of CANONICAL_COLUMNS[table]) {
        const camelCol = columnToCamel(col);
        expect(camelCol in record, `${table}.${col} -> ${camelCol} not found on a real ${camelTable} record`).toBe(true);
      }
    }
  });
});

const PRISMA_SCHEMA = `
model User {
  id String @id
  firstName String
  lastName String
  email String
  locale String
  createdAt String
  address Json
}
model Cart {
  id String @id
  userId String
  status String
  items Json
  createdAt String
  lastActivityDate String
  abandonmentTimeoutHours Int
  currency String
}
model AbandonedCheckout {
  id String @id
  cartId String
  userId String
  exitTimestamp String
  recoveryEmailSent Boolean
  recoveryEmailSentAt String?
  couponCodeOffered Boolean
  recovered Boolean
}
model Order {
  id String @id
  cartId String
  userId String
  items Json
  subtotal Float
  tax Float
  shipping Float
  total Float
  currency String
  createdAt String
  shippingAddress Json?
  status String
}
model Shipment {
  id String @id
  orderId String
  trackingNumber String
  carrier String
  packageIndex Int
  totalPackages Int
  items Json
  status String
  delayed Boolean
  events Json
}
model ReturnRequest {
  id String @id
  orderId String
  userId String
  reason String
  status String
  refundAmount Float
  requestedAt String
  resolvedAt String?
}
`;

function realMapping() {
  return buildSchemaMapping(parsePrismaSchema(PRISMA_SCHEMA));
}

describe("buildPrismaSeedScript", () => {
  const mapping = realMapping();
  const result = buildPrismaSeedScript(mapping, 7);

  it("matches every core table to its real model with no skips, against a schema that actually declares all six", () => {
    expect(result.skippedTables).toEqual([]);
  });

  it("writes both the seed script and the shared eco-seed.mjs generator", () => {
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(["prisma/seed.ts", "scripts/eco-seed.mjs"]);
  });

  it("the generated seed.ts references every real model name via createMany, in the real FK-safe order", () => {
    const seedFile = result.files.find((f) => f.path === "prisma/seed.ts")!.contents;
    const positions = ["user.createMany", "cart.createMany", "abandonedCheckout.createMany", "order.createMany", "shipment.createMany", "returnRequest.createMany"].map(
      (needle) => seedFile.indexOf(needle)
    );
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("bakes the given seed into the generated eco-seed.mjs", () => {
    const seedScript = result.files.find((f) => f.path === "scripts/eco-seed.mjs")!.contents;
    expect(seedScript).toContain("generate({ seed: 7 })");
  });

  it("running the ACTUAL generated seed.ts against a stub @prisma/client produces real, correctly-mapped data -- not asserted from reading the template", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eco-faker-prisma-test-"));
    try {
      // Stub @prisma/client: records real createMany calls instead of hitting
      // a real database (binaries.prisma.sh -- where the real query engine
      // is downloaded from -- isn't reachable from this environment).
      const stubDir = path.join(dir, "node_modules", "@prisma", "client");
      execSync(`mkdir -p ${stubDir}`);
      const stubModule = `
        const fs = require("fs");
        class PrismaClient {
          constructor() {
            this.calls = [];
            for (const model of ["user","cart","abandonedCheckout","order","shipment","returnRequest"]) {
              this[model] = { createMany: async ({ data }) => { this.calls.push({ model, data }); return { count: data.length }; } };
            }
          }
          async $disconnect() { fs.writeFileSync(process.env.RECORD_PATH, JSON.stringify(this.calls)); }
        }
        module.exports = { PrismaClient };
      `;
      writeFileSync(path.join(stubDir, "default.js"), stubModule, "utf-8");
      writeFileSync(path.join(stubDir, "package.json"), JSON.stringify({ name: "@prisma/client", main: "default.js" }), "utf-8");

      // Use this real repo's own compiled dist for eco-faker's generate/serialize.
      const seedScript = result.files.find((f) => f.path === "scripts/eco-seed.mjs")!.contents.replace('from "eco-faker"', `from "${process.cwd()}/dist/index.js"`);
      writeFileSync(path.join(dir, "eco-seed.mjs"), seedScript, "utf-8");
      writeFileSync(path.join(dir, "seed.ts"), result.files.find((f) => f.path === "prisma/seed.ts")!.contents, "utf-8");

      execSync(`node eco-seed.mjs`, { cwd: dir });
      const recordPath = path.join(dir, "recorded.json");
      execSync(`npx tsx seed.ts`, { cwd: dir, env: { ...process.env, RECORD_PATH: recordPath } });

      const calls = JSON.parse(require("node:fs").readFileSync(recordPath, "utf-8")) as { model: string; data: Record<string, unknown>[] }[];
      const userCall = calls.find((c) => c.model === "user")!;
      expect(userCall.data.length).toBeGreaterThan(0);
      const firstUser = userCall.data[0];
      expect(typeof firstUser.firstName).toBe("string");
      expect(typeof firstUser.email).toBe("string");
      expect(typeof firstUser.address).toBe("object"); // passed through as a real object, not stringified

      const orderCall = calls.find((c) => c.model === "order")!;
      expect(orderCall.data[0]).toHaveProperty("subtotal");
      expect(orderCall.data[0]).toHaveProperty("shippingAddress");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("buildDrizzleSeedScript", () => {
  it("generates a template with real model names and a clear fill-in marker for the connection", () => {
    const result = buildDrizzleSeedScript(realMapping(), 3);
    const script = result.files.find((f) => f.path === "scripts/eco-seed-drizzle.ts")!.contents;
    expect(script).toContain("schema.User");
    expect(script).toContain("schema.Order");
    expect(script).toContain("TODO");
  });
});

describe("buildSqlAlchemySeedScript", () => {
  it("generates syntactically valid Python", () => {
    const result = buildSqlAlchemySeedScript(realMapping(), 3);
    const script = result.files.find((f) => f.path === "seed.py")!.contents;
    const tmpFile = path.join(tmpdir(), `eco-faker-seed-test-${Date.now()}.py`);
    writeFileSync(tmpFile, script, "utf-8");
    try {
      expect(() => execSync(`python3 -c "compile(open('${tmpFile}').read(), '${tmpFile}', 'exec')"`)).not.toThrow();
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });

  it("references every real model name and shells out to the shared eco-seed.mjs", () => {
    const result = buildSqlAlchemySeedScript(realMapping(), 3);
    const script = result.files.find((f) => f.path === "seed.py")!.contents;
    expect(script).toContain("User(");
    expect(script).toContain("Order(");
    expect(script).toContain("eco-seed.mjs");
  });
});
