import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type { Address, Cart, EcoFakerConfig, Order, User } from "../../types.js";
import { generateAddress } from "../user/index.js";

/**
 * Convert an already-"converted" Cart into an Order.
 * Items are copied verbatim (relational integrity: order items === cart
 * items when converted). Financials are computed by rounding each component
 * first and summing the rounded values, so subtotal + tax + shipping always
 * equals total exactly -- no floating point drift.
 */
export function convertCartToOrder(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  cart: Cart,
  user: User,
  referenceNow: number
): Order {
  const subtotal = Math.round(cart.items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;
  const tax = Math.round(subtotal * config.taxRate * 100) / 100;
  const shipping =
    subtotal >= config.freeShippingThreshold ? 0 : config.flatShippingCost;
  const total = Math.round((subtotal + tax + shipping) * 100) / 100;

  const missingAddress = rng.chance(config.missingAddressRate);
  const shippingAddress: Address | null = missingAddress ? null : generateAddress(faker);

  // Order is created shortly after the cart's last activity (checkout
  // flow) -- but a converting cart's own lastActivityDate can legitimately
  // be as recent as referenceNow itself (see cart/index.ts), so adding
  // 1-30 minutes on top of it without a clamp could push createdAt past
  // referenceNow into the future. A real, pre-existing bug (predates this
  // session's work, latent in the foundational generate() path this
  // entire project builds on) -- caught by the temporal engine's strict
  // cross-segment timestamp-boundary check, then confirmed to affect
  // plain, non-temporal generate() too across multiple seeds.
  const createdAt = new Date(
    Math.min(new Date(cart.lastActivityDate).getTime() + rng.int(1, 30) * 60 * 1000, referenceNow)
  );

  const totalFormatted = new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: cart.currency,
  }).format(total);

  return {
    id: faker.string.uuid(),
    cartId: cart.id,
    userId: user.id,
    items: cart.items,
    subtotal,
    tax,
    shipping,
    total,
    totalFormatted,
    currency: cart.currency,
    createdAt: createdAt.toISOString(),
    shippingAddress,
    // Status is finalized later once shipments/tracking are generated.
    status: "processing",
  };
}
