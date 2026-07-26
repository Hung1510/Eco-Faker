import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type { Address, EcoFakerConfig, User } from "../../types.js";
import { createUniqueTracker } from "../../unique.js";

/**
 * Not every locale's faker-js data models a "state"/region concept the
 * same way -- verified directly against all 73 currently-supported
 * locales (see locales.ts), not assumed: `cs-CZ` and `sk` have real state
 * data but no *abbreviated* form, and `ro-MD` has no state data at all.
 * `faker.location.state({ abbreviated: true })` throws in the first two
 * cases, plain `faker.location.state()` throws in the third. Falls back
 * to a real value one step down this chain rather than fabricating one;
 * an empty string for the rare locale with no regional-subdivision
 * concept in its data at all is more honest than inventing a fake region
 * name that doesn't correspond to anything real.
 */
function safeState(faker: Faker): string {
  try {
    return faker.location.state({ abbreviated: true });
  } catch {
    try {
      return faker.location.state();
    } catch {
      return "";
    }
  }
}

/**
 * Real, not hypothetical: `en-HK` (Hong Kong) has no postal code data in
 * faker-js at all, and throws on `location.zipCode()` -- verified against
 * all 73 currently-supported locales, the only one that does. This is
 * historically accurate, not a data gap to route around: Hong Kong
 * genuinely doesn't use postal codes in real addresses. An empty string
 * reflects that honestly rather than fabricating a postal code that
 * wouldn't correspond to anything real.
 */
function safePostalCode(faker: Faker): string {
  try {
    return faker.location.zipCode();
  } catch {
    return "";
  }
}

export function generateAddress(faker: Faker): Address {
  return {
    line1: faker.location.streetAddress(),
    line2: faker.datatype.boolean({ probability: 0.25 })
      ? faker.location.secondaryAddress()
      : null,
    city: faker.location.city(),
    state: safeState(faker),
    postalCode: safePostalCode(faker),
    country: faker.location.country(),
  };
}

export function generateUsers(faker: Faker, rng: Rng, config: EcoFakerConfig, now: number): User[] {
  const users: User[] = [];
  const historyMs = config.historicalDays * 24 * 60 * 60 * 1000;
  // Real, reproducible bug without this: at a few thousand users, two
  // faker.internet.email({firstName, lastName}) calls landing on the same
  // real first/last name pair (a real, expected occurrence -- there are
  // only so many common first/last names) can produce the exact same
  // email, silently. Confirmed directly: seeds 3/4/8 at scaleFactor 5000
  // each produced 1-2 real duplicate emails before this fix. Scoped to
  // this one generateUsers() call -- see unique.ts's own doc comment for
  // why that scoping matters.
  const uniqueEmail = createUniqueTracker<string>();

  for (let i = 0; i < config.scaleFactor; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const createdAt = new Date(now - rng.int(0, historyMs));

    users.push({
      id: faker.string.uuid(),
      firstName,
      lastName,
      email: uniqueEmail.next(() => faker.internet.email({ firstName, lastName }).toLowerCase()),
      locale: config.locale,
      createdAt: createdAt.toISOString(),
      address: generateAddress(faker),
    });
  }

  return users;
}
