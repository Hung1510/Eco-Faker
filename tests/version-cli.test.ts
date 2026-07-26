import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Real end-to-end tests against the actual built CLI (`dist/cli.js`), run
 * with a temp directory as cwd so each test gets its own isolated
 * `.eco-faker/versions` store -- not the action handlers called directly,
 * since the flag-wiring/precedence-merging (mergeOverrides(parent.config,
 * resolveOverrides(opts))) lives in cli.ts itself and unit-testing
 * version-store.ts alone wouldn't catch a bug there.
 */
const CLI = path.resolve(process.cwd(), "dist/cli.js");

function run(args: string, cwd: string): string {
  return execSync(`node "${CLI}" ${args}`, { cwd, encoding: "utf-8" });
}

function runExpectFailure(args: string, cwd: string): { status: number; output: string } {
  try {
    execSync(`node "${CLI}" ${args}`, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    throw new Error("expected command to fail but it succeeded");
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("my-eco-gen version (CLI end-to-end)", () => {
  let dir: string;

  beforeEach(() => {
    if (!existsSync(CLI)) throw new Error("dist/cli.js not found -- run `npm run build` before this test suite.");
    dir = mkdtempSync(path.join(tmpdir(), "eco-version-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("save writes a real version file under .eco-faker/versions", () => {
    const out = run(`version save v1 --users 50 --seed 1 --message "baseline"`, dir);
    expect(out).toContain('Saved version "v1"');
    expect(existsSync(path.join(dir, ".eco-faker/versions/v1.json"))).toBe(true);
  });

  it("save refuses a duplicate name with exit code 1", () => {
    run(`version save v1 --users 50 --seed 1`, dir);
    const { status, output } = runExpectFailure(`version save v1 --users 50 --seed 1`, dir);
    expect(status).toBe(1);
    expect(output).toMatch(/already exists/);
  });

  it("list reports an empty store honestly, then shows saved versions", () => {
    const empty = run(`version list`, dir);
    expect(empty).toMatch(/No versions saved yet/);

    run(`version save v1 --users 50 --seed 1 --message "first"`, dir);
    const withOne = run(`version list`, dir);
    expect(withOne).toContain("v1");
    expect(withOne).toContain("parent=(none)");
    expect(withOne).toContain("first");
  });

  it("branch layers explicit flags on top of the parent's real config, and records lineage", () => {
    run(`version save v1 --users 50 --seed 1`, dir);
    run(`version branch v1 v2 --users 200 --message "scaled up"`, dir);

    const list = run(`version list`, dir);
    expect(list).toContain("parent=v1");

    const log = run(`version log v2`, dir);
    // Root-first: v1 must appear before v2.
    expect(log.indexOf("v1")).toBeLessThan(log.indexOf("v2"));

    // The branch actually applied: v2's real generated dataset has more
    // users than v1's, matching the --users 200 override, not the parent's 50.
    const diffOutput = run(`version diff v1 v2`, dir);
    expect(diffOutput).toMatch(/users\s+50\s+->\s+200/);
  });

  it("branch preserves everything from the parent it doesn't override -- same seed produces the same relative shape", () => {
    run(`version save v1 --users 100 --seed 5`, dir);
    run(`version branch v1 v2 --historical-days 30`, dir);
    // Only --historical-days changed; --seed 5 and --users 100 should carry
    // through from the parent untouched -- confirmed by an unchanged user count.
    const diffOutput = run(`version diff v1 v2`, dir);
    expect(diffOutput).toMatch(/users\s+100\s+->\s+100/);
  });

  it("diff against an unknown version name exits 1 and lists what IS available", () => {
    run(`version save v1 --users 50 --seed 1`, dir);
    const { status, output } = runExpectFailure(`version diff v1 nope`, dir);
    expect(status).toBe(1);
    expect(output).toMatch(/Available: v1/);
  });

  it("branch from an unknown parent exits 1 with a clear message, and does not create the child", () => {
    const { status, output } = runExpectFailure(`version branch nope child --users 10`, dir);
    expect(status).toBe(1);
    expect(output).toMatch(/No version named "nope"/);
    expect(existsSync(path.join(dir, ".eco-faker/versions/child.json"))).toBe(false);
  });

  it("save --snapshot loads a real existing snapshot recipe instead of generating fresh", () => {
    run(`generate --users 30 --seed 99 --format json --output ds.json --snapshot ds.snapshot.json`, dir);
    run(`version save from-snap --snapshot ds.snapshot.json --message "from a snapshot"`, dir);
    const list = run(`version list`, dir);
    expect(list).toContain("from-snap");

    // Diffing it against a freshly-generated same-seed version should show zero drift.
    run(`version save fresh --users 30 --seed 99`, dir);
    const diffOutput = run(`version diff from-snap fresh`, dir);
    expect(diffOutput).toMatch(/users\s+30\s+->\s+30\s+\(\+0, /);
  });

  it("--dir points the whole command group at a custom store location", () => {
    run(`version save v1 --users 10 --seed 1 --dir custom-store`, dir);
    expect(existsSync(path.join(dir, "custom-store/v1.json"))).toBe(true);
    expect(existsSync(path.join(dir, ".eco-faker/versions/v1.json"))).toBe(false);
    const list = run(`version list --dir custom-store`, dir);
    expect(list).toContain("v1");
  });

  it("--keep-reference-now on branch reuses the parent's exact referenceNow", () => {
    run(`version save v1 --users 10 --seed 1`, dir);
    run(`version branch v1 v2 --keep-reference-now`, dir);
    const parentJson = JSON.parse(readFileSync(path.join(dir, ".eco-faker/versions/v1.json"), "utf-8"));
    const childJson = JSON.parse(readFileSync(path.join(dir, ".eco-faker/versions/v2.json"), "utf-8"));
    expect(childJson.referenceNow).toBe(parentJson.referenceNow);
  });
});
