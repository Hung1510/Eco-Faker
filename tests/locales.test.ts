import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { Faker, allLocales } from "@faker-js/faker";
import { SUPPORTED_LOCALES, resolveLocaleModules } from "../src/locales.js";
import { configSchemaObject } from "../src/config-schema-object.js";

describe("SUPPORTED_LOCALES", () => {
  it("is derived from the real, installed @faker-js/faker package, not a hand-copied list -- every real (non-joke) key it exports is present", () => {
    const realKeys = Object.keys(allLocales).filter((k) => k !== "base" && k !== "en_BORK" && k !== "en_AU_ocker");
    for (const key of realKeys) {
      expect(SUPPORTED_LOCALES).toContain(key.replace(/_/g, "-"));
    }
  });

  it("excludes joke locales (en_BORK, en_AU_ocker) and the internal base fallback", () => {
    expect(SUPPORTED_LOCALES).not.toContain("en-BORK");
    expect(SUPPORTED_LOCALES).not.toContain("en-AU-ocker");
    expect(SUPPORTED_LOCALES).not.toContain("base");
  });

  it("includes the four legacy aliases for backward compatibility", () => {
    for (const legacy of ["es-ES", "de-DE", "fr-FR", "vi-VN"]) {
      expect(SUPPORTED_LOCALES).toContain(legacy);
    }
  });

  it("matches config.schema.json's real locale enum exactly -- catches drift if either one is updated without the other", () => {
    const schemaPath = path.resolve(__dirname, "../config.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    const schemaLocales: string[] = schema.properties.locale.enum;
    expect([...schemaLocales].sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("matches config-schema-object.ts's mirrored enum exactly too", () => {
    const objectLocales: string[] = configSchemaObject.properties.locale.enum;
    expect([...objectLocales].sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });
});

describe("resolveLocaleModules", () => {
  it("resolves a real, current faker-js locale to real, genuinely different data than English", () => {
    const fakerJa = new Faker({ locale: resolveLocaleModules("ja") });
    const fakerEn = new Faker({ locale: resolveLocaleModules("en-US") });
    fakerJa.seed(1);
    fakerEn.seed(1);
    // Real assertion, not just "doesn't throw": Japanese first names should
    // not be ASCII-only the way English ones are.
    const jaName = fakerJa.person.firstName();
    expect(/[^\x00-\x7F]/.test(jaName), `expected a real non-ASCII Japanese name, got "${jaName}"`).toBe(true);
  });

  it("the four legacy aliases produce real, genuinely locale-appropriate names -- not a silent fallback to English (a real regression this project introduced and fixed while building this)", () => {
    const fakerEn = new Faker({ locale: resolveLocaleModules("en-US") });
    fakerEn.seed(1);
    const englishName = fakerEn.person.firstName() + " " + fakerEn.person.lastName();

    for (const [legacy, bare] of [
      ["es-ES", "es"],
      ["de-DE", "de"],
      ["fr-FR", "fr"],
      ["vi-VN", "vi"],
    ] as const) {
      const fakerLegacy = new Faker({ locale: resolveLocaleModules(legacy) });
      const fakerBare = new Faker({ locale: resolveLocaleModules(bare) });
      fakerLegacy.seed(1);
      fakerBare.seed(1);
      const legacyName = fakerLegacy.person.firstName() + " " + fakerLegacy.person.lastName();
      const bareName = fakerBare.person.firstName() + " " + fakerBare.person.lastName();

      expect(legacyName, `${legacy} should not silently fall back to English`).not.toBe(englishName);
      expect(legacyName, `${legacy} should resolve identically to its real faker-js equivalent "${bare}"`).toBe(bareName);
    }
  });

  it("falls back to English + base for an unrecognized locale code, rather than throwing", () => {
    expect(() => new Faker({ locale: resolveLocaleModules("xx-not-a-real-locale") })).not.toThrow();
    const faker = new Faker({ locale: resolveLocaleModules("xx-not-a-real-locale") });
    faker.seed(1);
    const fakerEn = new Faker({ locale: resolveLocaleModules("en-US") });
    fakerEn.seed(1);
    expect(faker.person.firstName()).toBe(fakerEn.person.firstName());
  });

  it("bare 'en' doesn't duplicate the English module in its own fallback chain", () => {
    const modules = resolveLocaleModules("en");
    expect(modules.filter((m) => m === allLocales.en).length).toBe(1);
  });
});

describe("my-eco-gen locales (CLI)", () => {
  it("prints every real supported locale, matching SUPPORTED_LOCALES exactly", () => {
    const cliPath = path.resolve(__dirname, "../src/cli.ts");
    const stdout = execFileSync("npx", ["tsx", cliPath, "locales"], { encoding: "utf-8" });
    for (const locale of SUPPORTED_LOCALES) {
      expect(stdout, `expected "${locale}" in locales CLI output`).toContain(locale);
    }
    expect(stdout).toContain(`${SUPPORTED_LOCALES.length} supported locales`);
  });
});
