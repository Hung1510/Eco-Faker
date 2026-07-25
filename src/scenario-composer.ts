import type { EcoFakerConfig } from "./types.js";
import { SCENARIOS, resolveScenario } from "./scenarios.js";
import { mergeOverrides } from "./config.js";

export interface ScenarioFile {
  name?: string;
  description?: string;
  /** Each entry is either a built-in scenario name (see SCENARIOS) or a path to another scenario file, resolved relative to the file that references it. */
  inherits?: string[];
  overrides?: Partial<EcoFakerConfig>;
}

/**
 * Abstracts file resolution/reading so the actual inheritance-resolution
 * logic (composeScenarioFile below) can be tested against an in-memory
 * fake instead of the real filesystem -- no temp files, no real disk I/O,
 * just a plain object graph.
 */
export interface ScenarioFileLoader {
  /** Returns a resolved file path if `ref` should be treated as a file (relative to `fromFilePath`'s directory), or null if `ref` is a built-in scenario name. Built-in names always take priority over a same-named file. */
  resolvePath(ref: string, fromFilePath: string): string | null;
  read(filePath: string): ScenarioFile;
}

export interface ComposedScenario {
  config: Partial<EcoFakerConfig>;
  /** The full inheritance chain, entry file first, in resolution order -- useful for showing the user what actually got composed. */
  chain: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateScenarioFileShape(parsed: unknown, filePath: string): asserts parsed is ScenarioFile {
  if (!isPlainObject(parsed)) {
    throw new Error(`Scenario file "${filePath}" must parse to an object, got ${typeof parsed}.`);
  }
  if (parsed.inherits !== undefined) {
    if (!Array.isArray(parsed.inherits) || !parsed.inherits.every((i) => typeof i === "string")) {
      throw new Error(`Scenario file "${filePath}": "inherits" must be an array of strings.`);
    }
  }
  if (parsed.overrides !== undefined && !isPlainObject(parsed.overrides)) {
    throw new Error(`Scenario file "${filePath}": "overrides" must be an object.`);
  }
}

/**
 * Resolves a scenario file's full `inherits` chain into a single merged
 * config, in the same left-to-right, later-wins precedence
 * `mergeOverrides` already uses everywhere else: each inherited entry
 * (in the order listed) is merged in first, then this file's own
 * `overrides` last, so a scenario file's own settings always win over
 * anything it inherits, and inherited entries listed later override
 * ones listed earlier.
 *
 * Detects circular inheritance (A inherits B inherits A) by tracking the
 * exact file-path chain currently being resolved and throwing a clear
 * error naming the full cycle, rather than recursing until a stack
 * overflow.
 */
export function composeScenarioFile(entryPath: string, loader: ScenarioFileLoader): ComposedScenario {
  const chain: string[] = [];

  function resolve(filePath: string): Partial<EcoFakerConfig> {
    if (chain.includes(filePath)) {
      throw new Error(`Circular scenario inheritance detected: ${[...chain, filePath].join(" -> ")}`);
    }
    chain.push(filePath);

    const parsed = loader.read(filePath);
    validateScenarioFileShape(parsed, filePath);

    const inheritedConfigs = (parsed.inherits ?? []).map((ref) => {
      const asPath = loader.resolvePath(ref, filePath);
      if (asPath === null) {
        if (!(ref in SCENARIOS)) {
          const valid = Object.keys(SCENARIOS).join(", ");
          throw new Error(
            `Scenario file "${filePath}" inherits "${ref}", which is neither a built-in scenario (${valid}) nor a resolvable file path.`
          );
        }
        return resolveScenario(ref);
      }
      return resolve(asPath);
    });

    return mergeOverrides(...inheritedConfigs, parsed.overrides);
  }

  const config = resolve(entryPath);
  return { config, chain };
}
