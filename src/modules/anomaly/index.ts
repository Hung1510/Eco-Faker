import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type { Address, Cart, EcoFakerConfig, LineItem, Order, Product, ReturnRequest } from "../../types.js";
import { pickLineItem } from "../cart/index.js";

const REMOTE_REGIONS: Array<{ state: string; city: string }> = [
  { state: "HI", city: "Honolulu" },
  { state: "HI", city: "Hilo" },
  { state: "AK", city: "Anchorage" },
  { state: "AK", city: "Juneau" },
  { state: "PR", city: "San Juan" },
];

const NEGATIVE_RETURN_REASONS = new Set([
  "Item damaged in transit",
  "Wrong item shipped",
  "Item not as described",
  "Size or fit issue",
]);

const REMOTE_SHIPPING_SURCHARGE = 24.99;

/**
 * Bot-activity anomaly: an unrealistically large cart (50+ line items),
 * created in the dead of night (2-4am), the classic signature of scripted
 * checkout abuse or inventory-scraping bots. Rewrites the cart's items and
 * createdAt in place and returns whether it fired.
 *
 * Line items are drawn from the same shared product catalog as everything
 * else (via `pickLineItem`) -- a real bot/scraping cart references real
 * product ids at abnormal *volume*, it doesn't invent fake SKUs. Using
 * invented ids here was a real bug: it silently produced hundreds of
 * catalog-referential-integrity lint failures on an otherwise completely
 * normal generated dataset, caught by `lint`'s new productId check.
 */
export function maybeInjectBotCart(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  cart: Cart,
  products: Product[]
): boolean {
  if (!config.anomalies.enabled) return false;
  if (!rng.chance(config.anomalies.botCartRate)) return false;

  const itemCount = rng.int(50, 120);
  const items: LineItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    const picked = pickLineItem(faker, rng, products);
    const quantity = rng.int(1, 10);
    items.push({
      ...picked,
      quantity,
      lineTotal: Math.round(picked.unitPrice * quantity * 100) / 100,
    });
  }

  const original = new Date(cart.createdAt);
  const lastActivity = new Date(cart.lastActivityDate).getTime();
  const nightHour = rng.int(2, 4);
  const forcedNight = new Date(original);
  forcedNight.setUTCHours(nightHour, rng.int(0, 59), rng.int(0, 59), 0);

  // Only force the 2-4am timestamp if doing so doesn't push createdAt past
  // the cart's own lastActivityDate (which would break timeline ordering).
  // The item-count signature alone is still a valid bot-activity flag even
  // when the time-of-day shift has to be skipped.
  const safeToShiftTime = forcedNight.getTime() <= lastActivity;

  cart.items = items;
  if (safeToShiftTime) cart.createdAt = forcedNight.toISOString();
  cart.anomaly = {
    type: "bot_activity",
    note: safeToShiftTime
      ? `${itemCount} line items added at ${nightHour}:00 UTC -- consistent with scripted checkout abuse.`
      : `${itemCount} line items in a single cart -- consistent with scripted checkout abuse.`,
  };
  return true;
}

/**
 * Remote-shipping anomaly: order ships to Hawaii, Alaska, or Puerto Rico,
 * which in the real world carries a freight surcharge most naive shipping
 * calculators forget to model. Recomputes shipping + total so downstream
 * financial-consistency checks still hold.
 */
export function maybeInjectRemoteShipping(
  rng: Rng,
  config: EcoFakerConfig,
  order: Order
): boolean {
  if (!config.anomalies.enabled) return false;
  if (!order.shippingAddress) return false; // missing-address orders never ship
  if (!rng.chance(config.anomalies.remoteShippingRate)) return false;

  const region = rng.pick(REMOTE_REGIONS);
  const remoteAddress: Address = {
    ...order.shippingAddress,
    city: region.city,
    state: region.state,
  };

  const newShipping = Math.round((order.shipping + REMOTE_SHIPPING_SURCHARGE) * 100) / 100;
  const newTotal = Math.round((order.subtotal + order.tax + newShipping) * 100) / 100;

  order.shippingAddress = remoteAddress;
  order.shipping = newShipping;
  order.total = newTotal;
  order.totalFormatted = new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: order.currency,
  }).format(newTotal);
  order.anomaly = {
    type: "remote_surcharge",
    note: `Remote-region shipping to ${region.city}, ${region.state} -- $${REMOTE_SHIPPING_SURCHARGE} freight surcharge applied.`,
  };
  return true;
}

/**
 * Contradictory-review anomaly: a return filed for a clearly negative
 * reason (damaged, wrong item, doesn't match description) that nonetheless
 * carries a top CSAT score -- the kind of inconsistent signal that trips up
 * naive sentiment-based fraud/quality models.
 */
export function maybeInjectContradictoryReturn(
  rng: Rng,
  config: EcoFakerConfig,
  returnRequest: ReturnRequest
): boolean {
  if (!config.anomalies.enabled) return false;
  if (!NEGATIVE_RETURN_REASONS.has(returnRequest.reason)) return false;
  if (!rng.chance(config.anomalies.contradictoryReturnRate)) return false;

  returnRequest.csatScore = 5;
  returnRequest.anomaly = {
    type: "contradictory_review",
    note: `Reason ("${returnRequest.reason}") implies dissatisfaction, but CSAT is a perfect 5 -- inconsistent signal for sentiment-based models.`,
  };
  return true;
}
