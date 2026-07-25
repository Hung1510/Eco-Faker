import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type { AbandonedCheckout, Dataset, EcoFakerConfig, EmailMessage, Order, ReturnRequest, Shipment } from "../../types.js";

export interface EmailResult {
  emailMessages: EmailMessage[];
}

function itemSummary(items: { name: string; quantity: number }[]): string {
  if (items.length === 1) return `${items[0].name} (x${items[0].quantity})`;
  return `${items[0].name} and ${items.length - 1} other item${items.length - 1 === 1 ? "" : "s"}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function buildOrderConfirmationEmail(order: Order): { subject: string; body: string } {
  return {
    subject: `Order confirmed -- #${shortId(order.id)}`,
    body: `Thanks for your order! We've received order #${shortId(order.id)} for ${itemSummary(order.items)}, total ${order.totalFormatted}. We'll email you again once it ships.`,
  };
}

function buildShippingNotificationEmail(order: Order, shipment: Shipment): { subject: string; body: string } {
  return {
    subject: `Your order is on the way -- #${shortId(order.id)}`,
    body: `Good news -- your order #${shortId(order.id)} has shipped via ${shipment.carrier}. Tracking number: ${shipment.trackingNumber}. ${itemSummary(shipment.items)} ${shipment.items.length === 1 ? "is" : "are"} on the way.`,
  };
}

function buildDeliveryConfirmationEmail(order: Order, shipment: Shipment): { subject: string; body: string } {
  return {
    subject: `Delivered -- order #${shortId(order.id)}`,
    body: `Your order #${shortId(order.id)} (${itemSummary(shipment.items)}) was delivered. We hope you love it -- let us know if anything's not right.`,
  };
}

function buildCartAbandonmentRecoveryEmail(checkout: AbandonedCheckout, itemSummaryText: string): { subject: string; body: string } {
  const couponLine = checkout.couponCodeOffered
    ? ` Use code ${checkout.couponCodeOffered} for a discount if you complete your purchase now.`
    : "";
  return {
    subject: "You left something in your cart",
    body: `Still thinking it over? ${itemSummaryText} ${itemSummaryText.includes(" and ") ? "are" : "is"} still in your cart, waiting for you.${couponLine}`,
  };
}

function buildReturnConfirmationEmail(ret: ReturnRequest, order: Order): { subject: string; body: string } {
  return {
    subject: `Return received -- order #${shortId(order.id)}`,
    body: `We've received your return request for order #${shortId(order.id)} (${ret.reason}). Refund amount: ${ret.refundAmountFormatted}. We'll confirm once it's processed.`,
  };
}

/**
 * Generates transactional email messages as a post-processing pass over
 * an already-complete dataset, with its own decoupled RNG/Faker
 * instances -- same architecture as recommendation data, inventory
 * simulation, and support tickets, for the same reason: toggling this
 * feature never shifts any other table's output.
 *
 * Every email is grounded in a real timestamp and real content already
 * present elsewhere in the dataset, not fabricated: order confirmations
 * fire off the order's own real `createdAt`; shipping notifications fire
 * at the shipment's real "Label Created"/"Picked Up" event timestamp;
 * delivery confirmations fire at the real "Delivered" event; and cart-
 * abandonment recovery emails fire at `AbandonedCheckout.
 * recoveryEmailSentAt` -- a real timestamp that already existed in this
 * dataset with no email content behind it at all until now.
 */
export function generateEmailMessages(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  dataset: Dataset,
  referenceNow: number
): EmailResult {
  const emailMessages: EmailMessage[] = [];

  if (!config.emailMessages.enabled) {
    return { emailMessages };
  }

  const hour = 60 * 60 * 1000;

  function push(
    userId: string,
    orderId: string | null,
    cartId: string | null,
    type: EmailMessage["type"],
    sentAtMs: number,
    subject: string,
    body: string
  ): void {
    const opened = rng.chance(0.45);
    emailMessages.push({
      id: faker.string.uuid(),
      userId,
      orderId,
      cartId,
      type,
      subject,
      body,
      sentAt: new Date(Math.min(sentAtMs, referenceNow)).toISOString(),
      opened,
      // Clicking a link inside an email you never opened isn't a real
      // possibility -- clicked is only ever rolled, and can only ever be
      // true, conditional on the email having actually been opened.
      // Real bug, same status/date-consistency class as the inventory
      // simulation and support ticket modules both hit earlier: two
      // fields that are supposed to agree, generated independently.
      clicked: opened && rng.chance(0.15),
    });
  }

  // 1. Order confirmation -- every order, a few minutes after it's placed.
  for (const order of dataset.orders) {
    const { subject, body } = buildOrderConfirmationEmail(order);
    push(order.userId, order.id, order.cartId, "order_confirmation", Date.parse(order.createdAt) + rng.int(1, 15) * 60 * 1000, subject, body);
  }

  // 2. Shipping notification -- grounded in the shipment's own real
  //    "Label Created" or "Picked Up" tracking event, whichever exists first.
  const ordersById = new Map(dataset.orders.map((o) => [o.id, o]));
  for (const shipment of dataset.shipments) {
    const order = ordersById.get(shipment.orderId);
    if (!order) continue;
    const shippedEvent = shipment.events.find((e) => e.status === "Picked Up") ?? shipment.events.find((e) => e.status === "Label Created");
    if (!shippedEvent) continue;
    const { subject, body } = buildShippingNotificationEmail(order, shipment);
    push(order.userId, order.id, order.cartId, "shipping_notification", Date.parse(shippedEvent.timestamp) + rng.int(0, 2) * hour, subject, body);

    // 3. Delivery confirmation -- grounded in the shipment's own real "Delivered" event.
    const deliveredEvent = shipment.events.find((e) => e.status === "Delivered");
    if (deliveredEvent) {
      const { subject: dSubject, body: dBody } = buildDeliveryConfirmationEmail(order, shipment);
      push(order.userId, order.id, order.cartId, "delivery_confirmation", Date.parse(deliveredEvent.timestamp) + rng.int(0, 1) * hour, dSubject, dBody);
    }
  }

  // 4. Cart abandonment recovery -- fills in real content for a
  //    timestamp (`recoveryEmailSentAt`) that already existed with no
  //    email body behind it at all.
  const cartsById = new Map(dataset.carts.map((c) => [c.id, c]));
  for (const checkout of dataset.abandonedCheckouts) {
    if (!checkout.recoveryEmailSentAt) continue;
    const cart = cartsById.get(checkout.cartId);
    const itemText = cart && cart.items.length > 0 ? itemSummary(cart.items) : "Your item";
    const { subject, body } = buildCartAbandonmentRecoveryEmail(checkout, itemText);
    push(checkout.userId, null, checkout.cartId, "cart_abandonment_recovery", Date.parse(checkout.recoveryEmailSentAt), subject, body);
  }

  // 5. Return confirmation -- every return request, shortly after it's filed.
  for (const ret of dataset.returnRequests) {
    const order = ordersById.get(ret.orderId);
    if (!order) continue;
    const { subject, body } = buildReturnConfirmationEmail(ret, order);
    push(ret.userId, order.id, order.cartId, "return_confirmation", Date.parse(ret.requestedAt) + rng.int(1, 6) * hour, subject, body);
  }

  emailMessages.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  return { emailMessages };
}
