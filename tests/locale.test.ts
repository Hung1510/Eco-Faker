import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { SUPPORTED_LOCALES } from "../src/locales.js";

describe("locale support", () => {
  // Every real, currently-supported locale -- not a sample. Two real,
  // locale-specific bugs (cs-CZ/sk lacking abbreviated state data, ro-MD
  // lacking state data entirely, en-HK lacking postal code data at all --
  // all historically accurate, not faker-js gaps to route around) were
  // only caught by checking every locale, not a hand-picked subset; a
  // sample would have missed exactly these three every time.
  for (const locale of SUPPORTED_LOCALES) {
    it(`generate() succeeds for locale ${locale} without throwing, and produces real non-empty core fields`, () => {
      // Regression test: a bare `new Faker({ locale: en_GB })` (no fallback
      // chain) throws on any field en_GB's data doesn't cover -- e.g.
      // person.first_name -- because faker-js requires an explicit
      // [locale, en, base] fallback chain for anything but the prebuilt
      // faker instances. Every locale here is a real path through
      // generateWithTargetFunnel and every other command that accepts
      // --locale, so this exercises the whole pipeline, not just faker's
      // constructor.
      const dataset = generate({ seed: 1, scaleFactor: 10, locale });
      expect(dataset.users.length).toBe(10);
      expect(dataset.users.every((u) => u.firstName.length > 0 && u.lastName.length > 0)).toBe(true);
      expect(dataset.users.every((u) => u.email.length > 0)).toBe(true);
      expect(dataset.users.every((u) => u.address.city.length > 0 && u.address.country.length > 0)).toBe(true);
      expect(dataset.config.locale).toBe(locale);
    });
  }

  it("state and postalCode are real, non-empty values for the overwhelming majority of locales -- only the real, historically-accurate exceptions (ro-MD for state; en-HK for postalCode) are legitimately empty", () => {
    const knownStateExceptions = new Set(["ro-MD"]); // no state/region concept in faker-js's data at all
    const knownPostalCodeExceptions = new Set(["en-HK"]); // Hong Kong genuinely has no postal codes
    let emptyPostal = 0;
    for (const locale of SUPPORTED_LOCALES) {
      const dataset = generate({ seed: 2, scaleFactor: 5, locale });
      for (const user of dataset.users) {
        if (user.address.state === "") {
          expect(knownStateExceptions.has(locale), `unexpected empty state for ${locale}`).toBe(true);
        }
        if (user.address.postalCode === "") {
          emptyPostal++;
          expect(knownPostalCodeExceptions.has(locale), `unexpected empty postalCode for ${locale}`).toBe(true);
        }
      }
    }
    expect(emptyPostal).toBeGreaterThan(0); // sanity: the en-HK case is actually being exercised
  });
});
