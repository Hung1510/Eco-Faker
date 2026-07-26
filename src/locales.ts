import { allLocales, type LocaleDefinition } from "@faker-js/faker";

/**
 * Locale codes present in @faker-js/faker's own `allLocales` export that
 * aren't real languages/regions -- excluded from what eco-faker exposes as
 * a selectable locale, kept out for the same reason a professional tool
 * doesn't offer a joke option next to real ones: `en_BORK` is the "Swedish
 * Chef" parody locale, `en_AU_ocker` is an exaggerated-slang parody of
 * Australian English. `base` isn't a locale at all -- it's the shared
 * fallback data every other locale is layered on top of.
 */
const EXCLUDED_LOCALE_KEYS = new Set(["base", "en_BORK", "en_AU_ocker"]);

/**
 * eco-faker's own pre-existing config values that aren't real
 * @faker-js/faker locale keys -- that library has no region-qualified
 * "es_ES"/"de_DE"/"fr_FR"/"vi_VN", only the bare "es"/"de"/"fr"/"vi" (the
 * region-qualified spelling was always just eco-faker's own display name
 * for the same bare locale). Confirmed as a real regression, not a
 * hypothetical one: resolving these dynamically without this alias map
 * produced the exact same faker.person.firstName() output as plain
 * "en-US" for all four -- a silent fallback to English, not the German/
 * Spanish/French/Vietnamese names these configs were always supposed to
 * produce. Kept as explicit aliases so an existing config file using any
 * of these four keeps working exactly as it always did.
 */
const LEGACY_LOCALE_ALIASES: Record<string, string> = {
  "es-ES": "es",
  "de-DE": "de",
  "fr-FR": "fr",
  "vi-VN": "vi",
};

/**
 * Every real locale @faker-js/faker actually ships, converted from its own
 * underscore form (`en_US`, `pt_BR`) to the hyphenated BCP-47-style form
 * eco-faker's own config uses elsewhere (`en-US`, `pt-BR`), plus the four
 * legacy aliases above. Computed from the installed package's real
 * exports at module-load time -- not a hand-copied list -- so a future
 * @faker-js/faker version adding or removing a locale changes this
 * automatically instead of silently drifting out of sync the way the old
 * hardcoded switch statement would have. `tests/locales.test.ts`
 * cross-checks `config.schema.json`'s own `locale` enum against this same
 * real list for exactly that reason.
 */
export const SUPPORTED_LOCALES: string[] = [
  ...Object.keys(allLocales)
    .filter((key) => !EXCLUDED_LOCALE_KEYS.has(key))
    .map((key) => key.replace(/_/g, "-")),
  ...Object.keys(LEGACY_LOCALE_ALIASES),
].sort();

function toFakerJsKey(locale: string): string {
  const aliased = LEGACY_LOCALE_ALIASES[locale] ?? locale;
  return aliased.replace(/-/g, "_");
}

/**
 * Builds the same kind of locale fallback chain eco-faker's generator
 * always has -- the requested locale's own data, then English, then the
 * shared `base` data -- but resolved dynamically against whatever
 * @faker-js/faker actually has installed, instead of a fixed switch
 * statement covering only a handful of hand-picked locales. An
 * unrecognized locale code falls back to English + base (the same
 * behavior the old code's `default:` case already had), rather than
 * throwing -- config.schema.json's `locale` enum is what actually
 * prevents a typo'd locale from reaching this function in the first
 * place, so this function's job is just resolution, not validation.
 */
export function resolveLocaleModules(locale: string): LocaleDefinition[] {
  const key = toFakerJsKey(locale);
  const specific = allLocales[key as keyof typeof allLocales];
  const modules: LocaleDefinition[] = [];
  if (specific && key !== "en") modules.push(specific as LocaleDefinition);
  if (allLocales.en) modules.push(allLocales.en);
  if (allLocales.base) modules.push(allLocales.base);
  return modules;
}
