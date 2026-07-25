import { describe, expect, it } from "vitest";
import { composeScenarioFile, type ScenarioFile, type ScenarioFileLoader } from "../src/scenario-composer.js";
import { generate } from "../src/generator.js";

/** An in-memory fake loader -- files are plain objects keyed by a fake path string, no real filesystem involved. */
function fakeLoader(files: Record<string, ScenarioFile>): ScenarioFileLoader {
  return {
    resolvePath(ref, fromFilePath) {
      // Mirrors the real loader's rule: a bare name matching a file in
      // our fake filesystem is treated as a file reference; anything
      // else is assumed to be a built-in scenario name.
      if (ref in files) return ref;
      return null;
    },
    read(filePath) {
      if (!(filePath in files)) throw new Error(`fakeLoader: no such file "${filePath}"`);
      return files[filePath];
    },
  };
}

describe("scenario composer", () => {
  it("composes a single file with no inheritance", () => {
    const loader = fakeLoader({
      "a.yaml": { overrides: { scaleFactor: 500, abandonmentRate: 0.6 } },
    });
    const result = composeScenarioFile("a.yaml", loader);
    expect(result.config.scaleFactor).toBe(500);
    expect(result.config.abandonmentRate).toBe(0.6);
    expect(result.chain).toEqual(["a.yaml"]);
  });

  it("inherits from a single built-in scenario", () => {
    const loader = fakeLoader({
      "a.yaml": { inherits: ["black-friday"], overrides: { scaleFactor: 999 } },
    });
    const result = composeScenarioFile("a.yaml", loader);
    // black-friday sets abandonmentRate to 0.55; scaleFactor gets overridden locally.
    expect(result.config.abandonmentRate).toBe(0.55);
    expect(result.config.scaleFactor).toBe(999);
  });

  it("a file's own overrides win over anything it inherits", () => {
    const loader = fakeLoader({
      "a.yaml": { inherits: ["black-friday"], overrides: { abandonmentRate: 0.1 } },
    });
    const result = composeScenarioFile("a.yaml", loader);
    expect(result.config.abandonmentRate).toBe(0.1);
  });

  it("later entries in inherits override earlier ones, left to right", () => {
    const loader = fakeLoader({
      "a.yaml": { inherits: ["black-friday", "flash-sale"] },
    });
    const result = composeScenarioFile("a.yaml", loader);
    // Both scenarios set abandonmentRate; flash-sale (listed second) should win.
    expect(result.config.abandonmentRate).toBe(0.7); // flash-sale's value
  });

  it("inherits from another scenario file, recursively", () => {
    const loader = fakeLoader({
      "base.yaml": { overrides: { scaleFactor: 200, taxRate: 0.1 } },
      "child.yaml": { inherits: ["base.yaml"], overrides: { scaleFactor: 400 } },
    });
    const result = composeScenarioFile("child.yaml", loader);
    expect(result.config.scaleFactor).toBe(400); // child's own override wins
    expect(result.config.taxRate).toBe(0.1); // inherited from base
    expect(result.chain).toEqual(["child.yaml", "base.yaml"]);
  });

  it("supports a chain three files deep", () => {
    const loader = fakeLoader({
      "grandparent.yaml": { overrides: { taxRate: 0.05 } },
      "parent.yaml": { inherits: ["grandparent.yaml"], overrides: { scaleFactor: 100 } },
      "child.yaml": { inherits: ["parent.yaml"], overrides: { scaleFactor: 200 } },
    });
    const result = composeScenarioFile("child.yaml", loader);
    expect(result.config.taxRate).toBe(0.05);
    expect(result.config.scaleFactor).toBe(200);
    expect(result.chain).toEqual(["child.yaml", "parent.yaml", "grandparent.yaml"]);
  });

  it("mixes a built-in scenario and a file in the same inherits list", () => {
    const loader = fakeLoader({
      "base.yaml": { overrides: { taxRate: 0.15 } },
      "child.yaml": { inherits: ["black-friday", "base.yaml"] },
    });
    const result = composeScenarioFile("child.yaml", loader);
    expect(result.config.abandonmentRate).toBe(0.55); // from black-friday
    expect(result.config.taxRate).toBe(0.15); // from base.yaml
  });

  it("deep-merges nested config objects (anomalies) across the inheritance chain, not clobbering the whole object", () => {
    const loader = fakeLoader({
      "base.yaml": { overrides: { anomalies: { enabled: true, botCartRate: 0.5 } as any } },
      "child.yaml": { inherits: ["base.yaml"], overrides: { anomalies: { remoteShippingRate: 0.3 } as any } },
    });
    const result = composeScenarioFile("child.yaml", loader);
    expect(result.config.anomalies?.botCartRate).toBe(0.5);
    expect(result.config.anomalies?.remoteShippingRate).toBe(0.3);
  });

  describe("circular inheritance", () => {
    it("detects a direct two-file cycle and throws a clear error naming the chain", () => {
      const loader = fakeLoader({
        "a.yaml": { inherits: ["b.yaml"] },
        "b.yaml": { inherits: ["a.yaml"] },
      });
      expect(() => composeScenarioFile("a.yaml", loader)).toThrow(/Circular scenario inheritance.*a\.yaml.*b\.yaml.*a\.yaml/);
    });

    it("detects a self-referencing file", () => {
      const loader = fakeLoader({
        "a.yaml": { inherits: ["a.yaml"] },
      });
      expect(() => composeScenarioFile("a.yaml", loader)).toThrow(/Circular scenario inheritance/);
    });

    it("detects a longer indirect cycle (a -> b -> c -> a)", () => {
      const loader = fakeLoader({
        "a.yaml": { inherits: ["b.yaml"] },
        "b.yaml": { inherits: ["c.yaml"] },
        "c.yaml": { inherits: ["a.yaml"] },
      });
      expect(() => composeScenarioFile("a.yaml", loader)).toThrow(/Circular scenario inheritance/);
    });
  });

  describe("validation", () => {
    it("rejects an unknown inherits reference that isn't a built-in scenario or a resolvable file", () => {
      const loader = fakeLoader({
        "a.yaml": { inherits: ["nonexistent-thing"] },
      });
      expect(() => composeScenarioFile("a.yaml", loader)).toThrow(/neither a built-in scenario.*nor a resolvable file/);
    });

    it("rejects a file whose top-level content isn't an object", () => {
      const loader: ScenarioFileLoader = {
        resolvePath: () => null,
        read: () => "not an object" as any,
      };
      expect(() => composeScenarioFile("a.yaml", loader)).toThrow(/must parse to an object/);
    });

    it("rejects a non-array inherits field", () => {
      const loader: ScenarioFileLoader = {
        resolvePath: () => null,
        read: () => ({ inherits: "black-friday" } as any),
      };
      expect(() => composeScenarioFile("a.yaml", loader)).toThrow(/"inherits" must be an array of strings/);
    });

    it("rejects a non-object overrides field", () => {
      const loader: ScenarioFileLoader = {
        resolvePath: () => null,
        read: () => ({ overrides: "scaleFactor: 5" } as any),
      };
      expect(() => composeScenarioFile("a.yaml", loader)).toThrow(/"overrides" must be an object/);
    });
  });

  describe("real end-to-end integration with generate()", () => {
    it("a composed scenario's config produces a real, valid dataset when passed to generate()", () => {
      const loader = fakeLoader({
        "custom.yaml": { inherits: ["black-friday"], overrides: { scaleFactor: 50, seed: 7 } },
      });
      const { config } = composeScenarioFile("custom.yaml", loader);
      const dataset = generate(config);
      expect(dataset.users.length).toBe(50);
      expect(dataset.config.abandonmentRate).toBe(0.55); // inherited from black-friday
    });

    it("an invalid composed override (out-of-range value) surfaces a clear AJV error from generate(), not a silent bad dataset", () => {
      const loader = fakeLoader({
        "bad.yaml": { overrides: { abandonmentRate: 5 } as any }, // out of [0,1] range
      });
      const { config } = composeScenarioFile("bad.yaml", loader);
      expect(() => generate(config)).toThrow(/invalid config/);
    });
  });
});
