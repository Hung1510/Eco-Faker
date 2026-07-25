import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import type { Locale } from "../src/types.js";

const ALL_LOCALES: Locale[] = ["en-US", "en-GB", "es-ES", "de-DE", "fr-FR", "vi-VN"];

describe("locale support", () => {
  for (const locale of ALL_LOCALES) {
    it(`generate() succeeds for locale ${locale} without throwing on missing locale data`, () => {
      // Regression test: a bare `new Faker({ locale: en_GB })` (no fallback
      // chain) throws on any field en_GB's data doesn't cover -- e.g.
      // person.first_name -- because faker-js requires an explicit
      // [locale, en, base] fallback chain for anything but the prebuilt
      // faker instances. Every non-default locale here is a real path
      // through generateWithTargetFunnel and every other command that
      // accepts --locale, so this exercises the whole pipeline, not just
      // faker's constructor.
      const dataset = generate({ seed: 1, scaleFactor: 20, locale });
      expect(dataset.users.length).toBe(20);
      expect(dataset.users.every((u) => u.firstName.length > 0 && u.lastName.length > 0)).toBe(true);
      expect(dataset.config.locale).toBe(locale);
    });
  }
});
