import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type { Address, EcoFakerConfig, User } from "../../types.js";

export function generateAddress(faker: Faker): Address {
  return {
    line1: faker.location.streetAddress(),
    line2: faker.datatype.boolean({ probability: 0.25 })
      ? faker.location.secondaryAddress()
      : null,
    city: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    postalCode: faker.location.zipCode(),
    country: faker.location.country(),
  };
}

export function generateUsers(faker: Faker, rng: Rng, config: EcoFakerConfig, now: number): User[] {
  const users: User[] = [];
  const historyMs = config.historicalDays * 24 * 60 * 60 * 1000;

  for (let i = 0; i < config.scaleFactor; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const createdAt = new Date(now - rng.int(0, historyMs));

    users.push({
      id: faker.string.uuid(),
      firstName,
      lastName,
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      locale: config.locale,
      createdAt: createdAt.toISOString(),
      address: generateAddress(faker),
    });
  }

  return users;
}
