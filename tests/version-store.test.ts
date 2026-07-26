import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveVersion,
  loadVersion,
  listVersions,
  lineageChain,
  materializeVersion,
  versionExists,
  type VersionRecord,
} from "../src/version-store.js";

describe("version-store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "eco-version-store-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function record(overrides: Partial<VersionRecord> = {}): VersionRecord {
    return {
      name: "v1",
      createdAt: new Date().toISOString(),
      parent: null,
      referenceNow: Date.now(),
      config: { scaleFactor: 50, seed: 1 },
      ...overrides,
    };
  }

  it("round-trips a saved version through loadVersion", () => {
    saveVersion(dir, record({ name: "v1", message: "baseline" }));
    const loaded = loadVersion(dir, "v1");
    expect(loaded.name).toBe("v1");
    expect(loaded.message).toBe("baseline");
    expect(loaded.config).toEqual({ scaleFactor: 50, seed: 1 });
  });

  it("versionExists reflects real presence on disk, not a cache", () => {
    expect(versionExists(dir, "v1")).toBe(false);
    saveVersion(dir, record({ name: "v1" }));
    expect(versionExists(dir, "v1")).toBe(true);
  });

  it("refuses to overwrite an existing version by the same name", () => {
    saveVersion(dir, record({ name: "v1" }));
    expect(() => saveVersion(dir, record({ name: "v1" }))).toThrow(/already exists/);
  });

  it("rejects names that aren't plain identifiers -- a name is a filename, not a path", () => {
    expect(() => saveVersion(dir, record({ name: "../escape" }))).toThrow(/Invalid version name/);
    expect(() => saveVersion(dir, record({ name: "a/b" }))).toThrow(/Invalid version name/);
    expect(() => saveVersion(dir, record({ name: "" }))).toThrow(/Invalid version name/);
  });

  it("loadVersion on an unknown name lists what's actually available, not a generic error", () => {
    saveVersion(dir, record({ name: "v1" }));
    saveVersion(dir, record({ name: "v2", parent: "v1" }));
    expect(() => loadVersion(dir, "nope")).toThrow(/Available: v1, v2/);
  });

  it("loadVersion on an empty/nonexistent store says so rather than listing nothing", () => {
    expect(() => loadVersion(dir, "nope")).toThrow(/store is empty/);
  });

  it("listVersions on a store directory that was never created returns [], not an error", () => {
    const neverCreated = path.join(dir, "does-not-exist-yet");
    expect(listVersions(neverCreated)).toEqual([]);
  });

  it("listVersions returns every saved version, oldest first by createdAt", () => {
    saveVersion(dir, record({ name: "second", createdAt: "2026-01-02T00:00:00.000Z" }));
    saveVersion(dir, record({ name: "first", createdAt: "2026-01-01T00:00:00.000Z" }));
    const names = listVersions(dir).map((v) => v.name);
    expect(names).toEqual(["first", "second"]);
  });

  it("lineageChain walks parent pointers back to a root, in root-first order", () => {
    saveVersion(dir, record({ name: "root", parent: null }));
    saveVersion(dir, record({ name: "mid", parent: "root" }));
    saveVersion(dir, record({ name: "leaf", parent: "mid" }));
    const chain = lineageChain(dir, "leaf").map((v) => v.name);
    expect(chain).toEqual(["root", "mid", "leaf"]);
  });

  it("lineageChain on a root version alone is just that one record", () => {
    saveVersion(dir, record({ name: "root", parent: null }));
    expect(lineageChain(dir, "root").map((v) => v.name)).toEqual(["root"]);
  });

  it("lineageChain detects a real cycle instead of looping forever", () => {
    // Hand-construct a corrupted store a normal save/branch flow could never
    // produce (a's parent is b, b's parent is a) -- this can only happen via
    // manual file editing, but a clear error still beats an infinite loop.
    saveVersion(dir, record({ name: "a", parent: "b" }));
    saveVersion(dir, record({ name: "b", parent: "a" }));
    expect(() => lineageChain(dir, "a")).toThrow(/Cycle detected/);
  });

  it("materializeVersion actually regenerates a real dataset matching the stored recipe, not a stub", () => {
    const referenceNow = Date.now();
    const rec = record({ name: "v1", referenceNow, config: { scaleFactor: 40, seed: 7 } });
    const dataset = materializeVersion(rec);
    expect(dataset.users.length).toBeGreaterThan(0);
    // Determinism check: materializing the same recipe twice gives byte-identical results.
    const again = materializeVersion(rec);
    expect(JSON.stringify(dataset)).toBe(JSON.stringify(again));
  });
});
