import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { EcoFakerConfig, Dataset } from "./types.js";
import { generate } from "./generator.js";

/**
 * Default location for the version store, relative to the current working
 * directory -- deliberately not `.eco-faker/` at the package level, since
 * this is per-project user data (like `.git/`), not tool configuration.
 * Overridable via `--dir` on every `version` subcommand for anyone who
 * wants multiple independent stores or a shared/committed location.
 */
export const DEFAULT_VERSION_STORE_DIR = ".eco-faker/versions";

/**
 * One saved version: the same recipe shape `generate --snapshot` already
 * writes (config + referenceNow -- enough to regenerate a byte-identical
 * dataset later), plus version-store-specific bookkeeping. Deliberately
 * does NOT store the generated dataset itself -- only the recipe -- so a
 * store with hundreds of versions stays kilobytes, not gigabytes, the same
 * "regenerate from a small recipe" bet `--snapshot`/`replay`/`warp` already
 * made and that this feature builds directly on top of.
 */
export interface VersionRecord {
  name: string;
  message?: string;
  createdAt: string;
  /** Name of the version this was branched from, or null for a root version saved from scratch. */
  parent: string | null;
  referenceNow: number;
  config: Partial<EcoFakerConfig>;
}

/**
 * A name is used as a filename, not a path -- reject anything that isn't a
 * plain identifier so `version save "../../etc/passwd"` can't escape the
 * store directory, and so filenames stay predictable enough to `readdir`
 * back out safely.
 */
function assertValidName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid version name "${name}": use letters, numbers, ".", "_", or "-", starting with a letter or number.`);
  }
}

function versionPath(storeDir: string, name: string): string {
  assertValidName(name);
  return path.join(storeDir, `${name}.json`);
}

export function versionExists(storeDir: string, name: string): boolean {
  return existsSync(versionPath(storeDir, name));
}

export function saveVersion(storeDir: string, record: VersionRecord): void {
  assertValidName(record.name);
  if (versionExists(storeDir, record.name)) {
    throw new Error(
      `A version named "${record.name}" already exists in ${storeDir}. Choose a different name, or remove the existing file first.`
    );
  }
  mkdirSync(storeDir, { recursive: true });
  writeFileSync(versionPath(storeDir, record.name), JSON.stringify(record, null, 2) + "\n", "utf-8");
}

export function loadVersion(storeDir: string, name: string): VersionRecord {
  const p = versionPath(storeDir, name);
  if (!existsSync(p)) {
    const available = listVersions(storeDir).map((v) => v.name);
    throw new Error(
      `No version named "${name}" in ${storeDir}.` + (available.length > 0 ? ` Available: ${available.join(", ")}` : " (the store is empty -- run `version save` first)")
    );
  }
  return JSON.parse(readFileSync(p, "utf-8")) as VersionRecord;
}

/** Every saved version, oldest first. Empty array (not an error) if the store directory doesn't exist yet -- an empty store is a normal starting state, not a failure. */
export function listVersions(storeDir: string): VersionRecord[] {
  if (!existsSync(storeDir)) return [];
  return readdirSync(storeDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(storeDir, f), "utf-8")) as VersionRecord)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Walk parent pointers from `name` back to the root, returning the chain
 * root-first (so `chain[chain.length - 1]` is always `name` itself).
 * Detects a real cycle rather than looping forever -- this tool's own
 * writes can never produce one (a version's parent must already exist
 * before the child is saved), but a hand-edited store file could, and a
 * clear error beats a hang.
 */
export function lineageChain(storeDir: string, name: string): VersionRecord[] {
  const chain: VersionRecord[] = [];
  const seen = new Set<string>();
  let current: string | null = name;
  while (current !== null) {
    if (seen.has(current)) {
      throw new Error(`Cycle detected in version lineage at "${current}" -- the store's parent pointers are corrupted.`);
    }
    seen.add(current);
    const record = loadVersion(storeDir, current);
    chain.unshift(record);
    current = record.parent;
  }
  return chain;
}

/** Regenerate the actual dataset a version's recipe describes. Same "recipe, not raw data" bet `replay`/`warp` already made -- this is that same regeneration, just sourced from the version store instead of a `.snapshot.json` path. */
export function materializeVersion(record: VersionRecord): Dataset {
  return generate(record.config, record.referenceNow);
}
