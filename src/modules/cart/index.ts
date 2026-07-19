import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type {
  AbandonedCheckout,
  Cart,
  CartStatus,
  EcoFakerConfig,
  LineItem,
  Product,
  User,
} from "../../types.js";

const COUPON_PREFIXES = ["SAVE", "COMEBACK", "WELCOME", "TREAT", "EXTRA"];

function currencyForLocale(locale: string): string {
  switch (locale) {
    case "en-GB":
      return "GBP";
    case "es-ES":
    case "de-DE":
    case "fr-FR":
      return "EUR";
    case "vi-VN":
      return "VND";
    default:
      return "USD";
  }
}

/**
 * Picks a real product (and, if it has variants, a real variant) from the
 * shared catalog for one line item. Falls back to an ad hoc fake product
 * only if the catalog is empty (e.g. `catalogSize: 0`) -- defensive, not
 * the normal path.
 */
export function pickLineItem(faker: Faker, rng: Rng, products: Product[]): Omit<LineItem, "quantity" | "lineTotal"> {
  if (products.length === 0) {
    return {
      productId: faker.string.uuid(),
      sku: faker.string.alphanumeric({ length: 8, casing: "upper" }),
      name: faker.commerce.productName(),
      unitPrice: Number(faker.commerce.price({ min: 5, max: 300, dec: 2 })),
    };
  }

  const product = rng.pick(products);
  if (product.variants.length === 0) {
    return { productId: product.id, sku: product.sku, name: product.name, unitPrice: product.basePrice };
  }

  const variant = rng.pick(product.variants);
  const attrLabel = Object.values(variant.attributes).join("/");
  return {
    productId: product.id,
    sku: variant.sku,
    name: attrLabel ? `${product.name} (${attrLabel})` : product.name,
    unitPrice: Math.round((product.basePrice + variant.priceDelta) * 100) / 100,
  };
}

export function generateLineItems(faker: Faker, rng: Rng, config: EcoFakerConfig, products: Product[]): LineItem[] {
  const count = rng.int(config.itemsPerCart.min, config.itemsPerCart.max);
  const items: LineItem[] = [];

  for (let i = 0; i < count; i++) {
    const picked = pickLineItem(faker, rng, products);
    const quantity = rng.weighted([
      [1, 60],
      [2, 25],
      [3, 10],
      [4, 5],
    ]);
    items.push({
      ...picked,
      quantity,
      lineTotal: Math.round(picked.unitPrice * quantity * 100) / 100,
    });
  }

  return items;
}

/**
 * Decide a cart's terminal-ish status.
 * - `abandonmentRate` of carts are abandoned.
 * - The remainder convert, *except* a small slice of very recent carts
 *   (created within the abandonment timeout window) which are still
 *   legitimately "active" -- too soon to call abandoned or converted.
 */
function decideCartStatus(rng: Rng, createdAt: Date, config: EcoFakerConfig, now: number): CartStatus {
  const ageHours = (now - createdAt.getTime()) / (1000 * 60 * 60);

  // Too fresh to have been inactive for >3h yet -- can't be "abandoned".
  if (ageHours <= 3) return rng.chance(0.5) ? "active" : "converted";

  const stillFresh = ageHours < config.abandonmentTimeoutHours;
  if (stillFresh && rng.chance(0.15)) return "active";
  return rng.chance(config.abandonmentRate) ? "abandoned" : "converted";
}

export function generateCartsForUser(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  user: User,
  now: number,
  products: Product[]
): Cart[] {
  const count = rng.int(config.cartsPerUser.min, config.cartsPerUser.max);
  const carts: Cart[] = [];
  const historyMs = config.historicalDays * 24 * 60 * 60 * 1000;
  const userCreatedAtMs = new Date(user.createdAt).getTime();

  for (let i = 0; i < count; i++) {
    const earliestMs = Math.max(userCreatedAtMs, now - historyMs);
    const createdAt = rng.dateBetween(new Date(earliestMs), new Date(now));
    const status = decideCartStatus(rng, createdAt, config, now);

    let lastActivityDate: Date;
    if (status === "abandoned") {
      // Requirement: activity must be > 3h ago (now - lastActivityDate > 3h),
      // and the inactivity gap must be less than the abandonment timeout
      // (now - lastActivityDate < abandonmentTimeoutHours) -- i.e. it was
      // recently abandoned, not ancient history.
      const timeoutMs = config.abandonmentTimeoutHours * 60 * 60 * 1000;
      const threeHoursMs = 3 * 60 * 60 * 1000;
      const windowStartMs = Math.max(createdAt.getTime(), now - timeoutMs);
      const windowEndMs = now - threeHoursMs;
      lastActivityDate =
        windowStartMs >= windowEndMs
          ? new Date(windowEndMs)
          : rng.dateBetween(new Date(windowStartMs), new Date(windowEndMs));
    } else if (status === "active") {
      // Activity happened recently, within the timeout window, less than 3h ago.
      const threeHoursMs = 3 * 60 * 60 * 1000;
      lastActivityDate = rng.dateBetween(createdAt, new Date(now - rng.int(0, threeHoursMs)));
    } else {
      // converted: activity trails right up to conversion time.
      lastActivityDate = rng.dateBetween(createdAt, new Date(now));
    }

    carts.push({
      id: faker.string.uuid(),
      userId: user.id,
      status,
      items: generateLineItems(faker, rng, config, products),
      createdAt: createdAt.toISOString(),
      lastActivityDate: lastActivityDate.toISOString(),
      abandonmentTimeoutHours: config.abandonmentTimeoutHours,
      currency: currencyForLocale(config.locale),
    });
  }

  return carts;
}

export function generateAbandonedCheckout(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  cart: Cart
): AbandonedCheckout {
  const recoveryEmailSent = rng.chance(config.recoveryEmailRate);
  const exitTimestamp = cart.lastActivityDate;

  let recoveryEmailSentAt: string | null = null;
  let recovered = false;

  if (recoveryEmailSent) {
    const exitMs = new Date(exitTimestamp).getTime();
    const sentAt = rng.dateBetween(
      new Date(exitMs + 30 * 60 * 1000), // at least 30 min after exit
      new Date(exitMs + 12 * 60 * 60 * 1000) // within 12h
    );
    recoveryEmailSentAt = sentAt.toISOString();
    recovered = rng.chance(config.recoveryConversionRate);
  }

  const couponCodeOffered = rng.chance(config.couponOfferRate)
    ? `${rng.pick(COUPON_PREFIXES)}${rng.int(10, 25)}`
    : null;

  return {
    id: faker.string.uuid(),
    cartId: cart.id,
    userId: cart.userId,
    exitTimestamp,
    recoveryEmailSent,
    recoveryEmailSentAt,
    couponCodeOffered,
    recovered,
  };
}

export { currencyForLocale };
