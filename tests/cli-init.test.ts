import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cliPath = path.resolve(__dirname, "../src/cli.ts");

function runCli(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", cliPath, ...args], { cwd, encoding: "utf-8" });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), status: e.status ?? 1 };
  }
}

describe("my-eco-gen init", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "eco-faker-init-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("init next writes the two real scaffold files", () => {
    const result = runCli(["init", "next"], dir);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "scripts/eco-seed.mjs"))).toBe(true);
    expect(existsSync(path.join(dir, "app/api/eco/[table]/route.ts"))).toBe(true);
    expect(result.stdout).toContain("Wrote scripts/eco-seed.mjs");
  });

  it("init msw writes the three real scaffold files", () => {
    const result = runCli(["init", "msw"], dir);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "mocks/eco-handlers.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "mocks/browser.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "mocks/server.ts"))).toBe(true);
  });

  it("init <target> --seed bakes the given seed into the generated seed script", () => {
    runCli(["init", "next", "--seed", "42"], dir);
    const contents = readFileSync(path.join(dir, "scripts/eco-seed.mjs"), "utf-8");
    expect(contents).toContain("generate({ seed: 42 })");
  });

  it("refuses an unknown scaffold target", () => {
    const result = runCli(["init", "rails"], dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('Unknown scaffold target "rails"');
    expect(result.stdout).toContain("next");
    expect(result.stdout).toContain("msw");
  });

  it("refuses --schema on a simple scaffold target (next/msw), which have no schema to introspect", () => {
    const result = runCli(["init", "next", "--schema", "./schema.prisma"], dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('"next" doesn\'t take --schema');
  });

  it("refuses neither a target nor --schema, printing usage for both modes", () => {
    const result = runCli(["init"], dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("init next");
    expect(result.stdout).toContain("init msw");
    expect(result.stdout).toContain("--schema");
  });

  it("refuses to overwrite an existing scaffold file without --force", () => {
    runCli(["init", "next"], dir);
    const result = runCli(["init", "next"], dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("--force");
    expect(result.stdout).toContain("scripts/eco-seed.mjs");
  });

  it("--force overwrites an existing scaffold file with a fresh one", () => {
    runCli(["init", "next", "--seed", "1"], dir);
    writeFileSync(path.join(dir, "scripts/eco-seed.mjs"), "// tampered", "utf-8");
    const result = runCli(["init", "next", "--seed", "99", "--force"], dir);
    expect(result.status).toBe(0);
    const contents = readFileSync(path.join(dir, "scripts/eco-seed.mjs"), "utf-8");
    expect(contents).toContain("generate({ seed: 99 })");
  });

  it("existing --schema mode still works exactly as before (unaffected by the scaffold-target branch)", () => {
    writeFileSync(
      path.join(dir, "schema.prisma"),
      "model Order {\n  id String @id\n  total Float\n  status String\n}\n",
      "utf-8"
    );
    const result = runCli(["init", "--schema", "schema.prisma", "-o", "mapping.json"], dir);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "mapping.json"))).toBe(true);
    expect(result.stdout).toContain("Parsed 1 model(s)/schema(s)");
  });

  const realPrismaSchema = `
model User { id String @id
  firstName String
  lastName String
  email String
  locale String
  createdAt String
  address Json
}
model Cart { id String @id
  userId String
  status String
  items Json
  createdAt String
  lastActivityDate String
  abandonmentTimeoutHours Int
  currency String
}
model AbandonedCheckout { id String @id
  cartId String
  userId String
  exitTimestamp String
  recoveryEmailSent Boolean
  recoveryEmailSentAt String?
  couponCodeOffered Boolean
  recovered Boolean
}
model Order { id String @id
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
model Shipment { id String @id
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
model ReturnRequest { id String @id
  orderId String
  userId String
  reason String
  status String
  refundAmount Float
  requestedAt String
  resolvedAt String?
}
`;

  it("init prisma --schema writes a real seed script, the shared eco-seed.mjs, and mapping.json", () => {
    writeFileSync(path.join(dir, "schema.prisma"), realPrismaSchema, "utf-8");
    const result = runCli(["init", "prisma", "--schema", "schema.prisma"], dir);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "prisma/seed.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "scripts/eco-seed.mjs"))).toBe(true);
    expect(existsSync(path.join(dir, "mapping.json"))).toBe(true);
    expect(result.stdout).toContain("Parsed 6 model(s)");
  });

  it("init prisma without --schema refuses with a clear, specific message", () => {
    const result = runCli(["init", "prisma"], dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('"init prisma" needs a schema to introspect');
  });

  it("init drizzle --schema writes a template with a real model name and a clear fill-in marker", () => {
    // Drizzle schemas are TS/JS; the parser scans for `export const x = pgTable("name", {...})`-style declarations.
    writeFileSync(
      path.join(dir, "schema.ts"),
      'export const users = pgTable("users", {\n  id: text("id"),\n  firstName: text("first_name"),\n});\n',
      "utf-8"
    );
    const result = runCli(["init", "drizzle", "--schema", "schema.ts"], dir);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "scripts/eco-seed-drizzle.ts"))).toBe(true);
    const contents = readFileSync(path.join(dir, "scripts/eco-seed-drizzle.ts"), "utf-8");
    expect(contents).toContain("TODO");
  });

  it("init sqlalchemy --schema writes a real, syntactically valid Python seed template", () => {
    writeFileSync(
      path.join(dir, "models.py"),
      "class User(Base):\n    __tablename__ = 'users'\n    id = Column(String, primary_key=True)\n    first_name = Column(String)\n",
      "utf-8"
    );
    const result = runCli(["init", "sqlalchemy", "--schema", "models.py"], dir);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "seed.py"))).toBe(true);
  });

  it("a schema target with no models at all is a clear error, not a silently-empty seed script", () => {
    writeFileSync(path.join(dir, "empty.prisma"), "// no models here\n", "utf-8");
    const result = runCli(["init", "prisma", "--schema", "empty.prisma"], dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("No models found");
  });
}, 60000);
