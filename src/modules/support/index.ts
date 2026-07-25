import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type {
  Dataset,
  EcoFakerConfig,
  Order,
  Product,
  ProductRating,
  ReturnRequest,
  Shipment,
  SupportMessage,
  SupportTicket,
  TicketPriority,
  User,
} from "../../types.js";

export interface SupportResult {
  supportTickets: SupportTicket[];
  supportMessages: SupportMessage[];
}

const STATUS_WEIGHTS: [SupportTicket["status"], number][] = [
  ["resolved", 50],
  ["closed", 20],
  ["in_progress", 15],
  ["open", 15],
];

// --- Category-specific message libraries -----------------------------
// Each category has independent opener/detail/closer slots, combined via
// rng.pick for combinatorial variety, with real interpolated specifics
// (order id, tracking number, product name, refund amount, return
// reason) rather than generic placeholder prose.

function shippingOpeningMessage(user: User, order: Order, shipment: Shipment, rng: Rng): string {
  const orderRef = order.id.slice(0, 8);
  const openers = [
    `Hi, I placed order #${orderRef} and the tracking hasn't updated in several days.`,
    `My package for order #${orderRef} was supposed to arrive already but it's still showing in transit.`,
    `Checking in on order #${orderRef} -- the ${shipment.carrier} tracking number ${shipment.trackingNumber} looks stuck.`,
  ];
  const details = [
    `I paid for this order and just want to know when it'll actually show up.`,
    `Is there a delay on ${shipment.carrier}'s end, or did something happen to my package?`,
    `This was a ${order.totalFormatted} order and I'd appreciate an update either way.`,
  ];
  const closers = [
    `Thanks for looking into it.`,
    `Let me know what's going on when you get a chance.`,
    `Appreciate any info you can share.`,
  ];
  return `${rng.pick(openers)} ${rng.pick(details)} ${rng.pick(closers)}`;
}

function shippingAgentResponse(rng: Rng): string {
  return rng.pick([
    `Thanks for reaching out -- I'm looking into the tracking on our end now and will update you shortly.`,
    `Sorry for the trouble. I've flagged this with the carrier and will follow up as soon as I hear back.`,
    `I can see the delay on our system too. Let me check with the carrier directly and get back to you.`,
  ]);
}

function shippingResolutionMessage(order: Order, rng: Rng): string {
  return rng.pick([
    `Good news -- the carrier confirmed your package is moving again and should arrive within the next couple of days.`,
    `We've credited a partial shipping refund to your account for the delay on order #${order.id.slice(0, 8)}. Sorry again for the wait.`,
    `The carrier located your package and it's back in transit. Thanks for your patience.`,
  ]);
}

function returnOpeningMessage(user: User, order: Order, ret: ReturnRequest, rng: Rng): string {
  const orderRef = order.id.slice(0, 8);
  const reasonPhrase = ret.reason.toLowerCase();
  const openers = [
    `I submitted a return for order #${orderRef} (${reasonPhrase}) and wanted to check on the status.`,
    `Following up on my return request for order #${orderRef} -- reason was "${ret.reason}".`,
    `Hi, I'm waiting on my refund of ${ret.refundAmountFormatted} for order #${orderRef}.`,
  ];
  const details = [
    `It's been a little while and I haven't heard anything back.`,
    `Just want to make sure everything's on track before I follow up with my bank.`,
    `Can you confirm the return was received and the refund is processing?`,
  ];
  return `${rng.pick(openers)} ${rng.pick(details)}`;
}

function returnAgentResponse(rng: Rng): string {
  return rng.pick([
    `Thanks for checking in -- I can see your return in our system and it's being processed now.`,
    `I've confirmed the returned item was received at our warehouse. The refund should post within a few business days.`,
    `Sorry for the wait on this one. Let me push this through and confirm once it's done.`,
  ]);
}

function returnResolutionMessage(ret: ReturnRequest, rng: Rng): string {
  return rng.pick([
    `Your refund of ${ret.refundAmountFormatted} has been processed and should reflect on your statement soon.`,
    `All set -- the refund for this return has gone through. Let us know if you don't see it within a few days.`,
    `Refund issued. Thanks for your patience while we got this sorted out.`,
  ]);
}

function productOpeningMessage(user: User, product: Product, rating: ProductRating, rng: Rng): string {
  const openers = [
    `I bought the ${product.name} and honestly wasn't happy with it.`,
    `Writing about the ${product.name} I ordered -- it didn't meet expectations.`,
    `Not sure if this is the right place, but I had an issue with the ${product.name}.`,
  ];
  const details = rating.reviewText
    ? [`Left a review too: "${rating.reviewText}"`, `I mentioned this in my review as well.`]
    : [`I gave it ${rating.rating} out of 5 stars.`, `Rated it ${rating.rating}/5 for reference.`];
  const closers = [
    `Wondering if there's anything you can do -- exchange, refund, anything.`,
    `Just wanted to flag it in case others report the same thing.`,
    `Let me know what my options are.`,
  ];
  return `${rng.pick(openers)} ${rng.pick(details)} ${rng.pick(closers)}`;
}

function productAgentResponse(rng: Rng): string {
  return rng.pick([
    `Sorry to hear that -- thanks for the detailed feedback, it genuinely helps us improve the listing.`,
    `That's disappointing to hear. I'd like to make this right -- let me look at options for you.`,
    `Appreciate you flagging this. I'm passing your feedback to the product team as well.`,
  ]);
}

function productResolutionMessage(rng: Rng): string {
  return rng.pick([
    `We've gone ahead and processed a partial refund for the inconvenience.`,
    `I've set up a free replacement for you -- should arrive within the usual delivery window.`,
    `Thanks again for the feedback. Let us know if there's anything else we can do.`,
  ]);
}

function missingAddressOpeningMessage(order: Order, rng: Rng): string {
  const orderRef = order.id.slice(0, 8);
  return rng.pick([
    `I placed order #${orderRef} but never got a confirmation with my shipping address on it -- can you confirm where it's headed?`,
    `Quick question on order #${orderRef} -- I don't see a delivery address anywhere in my confirmation email.`,
    `Order #${orderRef} went through but I want to double check the shipping address is correct before it ships.`,
  ]);
}

function missingAddressAgentResponse(rng: Rng): string {
  return rng.pick([
    `Thanks for flagging this -- let me pull up your order and confirm the address on file.`,
    `Good catch. I'm checking our records now to make sure everything's set correctly.`,
  ]);
}

function missingAddressResolutionMessage(rng: Rng): string {
  return rng.pick([
    `Confirmed and updated -- your order is set to ship to the correct address now.`,
    `All good on our end, the address is on file correctly. Sorry for the confusing confirmation email.`,
  ]);
}

function presalesOpeningMessage(product: Product, rng: Rng): string {
  return rng.pick([
    `Quick question before I buy -- does the ${product.name} come in other colors/sizes?`,
    `I'm considering the ${product.name} -- what's the estimated delivery time if I order today?`,
    `Is the ${product.name} currently in stock? Wanted to check before ordering.`,
  ]);
}

function presalesAgentResponse(rng: Rng): string {
  return rng.pick([
    `Thanks for checking! Yes, it's in stock and ships within our usual window -- let me know if you have other questions.`,
    `Good question -- happy to help you decide. Feel free to ask anything else before you order.`,
  ]);
}

function genericAccountOpeningMessage(rng: Rng): string {
  return rng.pick([
    `I'm having trouble resetting my account password -- the reset email never arrived.`,
    `Can you help me update the email address on my account?`,
    `I'd like to close my account -- how do I go about that?`,
  ]);
}

function genericAccountAgentResponse(rng: Rng): string {
  return rng.pick([
    `Happy to help with that -- I've sent a fresh reset link, let me know if it doesn't come through this time.`,
    `Sure thing, I've made that update on our end. You should see the change reflected shortly.`,
  ]);
}

function pickPriority(rng: Rng, weights: [TicketPriority, number][]): TicketPriority {
  return rng.weighted(weights);
}

/**
 * Generates support tickets and their threaded messages as a
 * post-processing pass over an already-complete dataset, with its own
 * decoupled RNG/Faker instances (offset seed, distinct from
 * recommendation data's and inventory simulation's) -- same architecture
 * as those two modules, for the same reason: toggling this feature never
 * shifts any other table's output.
 *
 * Every ticket is grounded in a real signal already present elsewhere in
 * the dataset -- a shipment's own `delayed` flag, a real
 * `ReturnRequest.reason`, a real low `ProductRating`, or a real order
 * with a null `shippingAddress` -- rather than generating incidents that
 * don't correspond to anything else in the data. A small, deliberately
 * modest share of tickets (pre-sales questions grounded in real
 * `ProductView` history, and a handful of ungrounded generic
 * account questions) aren't tied to a specific bad outcome, matching how
 * real support systems also get non-incident tickets.
 */
export function generateSupportTickets(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  dataset: Dataset,
  referenceNow: number
): SupportResult {
  const supportTickets: SupportTicket[] = [];
  const supportMessages: SupportMessage[] = [];

  if (!config.supportTickets.enabled) {
    return { supportTickets, supportMessages };
  }

  const usersById = new Map(dataset.users.map((u) => [u.id, u]));
  const ordersById = new Map(dataset.orders.map((o) => [o.id, o]));
  const productsById = new Map(dataset.products.map((p) => [p.id, p]));
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;

  function pushTicket(
    user: User,
    createdAtMs: number,
    category: SupportTicket["category"],
    subject: string,
    priorityWeights: [TicketPriority, number][],
    openingBody: string,
    agentResponse: () => string,
    resolutionMessage: (() => string) | null,
    refs: { orderId?: string; returnRequestId?: string; productId?: string } = {}
  ): void {
    const status = rng.weighted(STATUS_WEIGHTS);
    const priority = pickPriority(rng, priorityWeights);
    const ticketId = faker.string.uuid();

    let resolvedAtMs: number | null = null;
    const messages: { sender: "customer" | "agent"; body: string; ms: number }[] = [
      { sender: "customer", body: openingBody, ms: createdAtMs },
    ];

    if (status !== "open") {
      const ackMs = Math.min(createdAtMs + rng.int(1, 20) * hour, referenceNow);
      messages.push({ sender: "agent", body: agentResponse(), ms: ackMs });

      if (status === "resolved" || status === "closed") {
        if (resolutionMessage) {
          const resolveMs = Math.min(ackMs + rng.int(1, 3) * day, referenceNow);
          messages.push({ sender: "agent", body: resolutionMessage(), ms: resolveMs });
          resolvedAtMs = resolveMs;
          if (rng.chance(0.4)) {
            messages.push({
              sender: "customer",
              body: rng.pick(["Thank you, appreciate the quick help!", "Great, thanks for sorting that out.", "Perfect, thanks!"]),
              ms: Math.min(resolveMs + rng.int(1, 6) * hour, referenceNow),
            });
          }
        } else {
          // No dedicated resolution message for this category (a simple
          // pre-sales or generic-account question) -- the agent's single
          // reply legitimately IS the resolution, so resolvedAt uses that
          // timestamp rather than staying null while status says
          // "resolved"/"closed". A ticket claiming to be resolved with no
          // real resolution timestamp would be the same status/date
          // inconsistency bug already fixed once in the inventory
          // simulation module -- caught here by a test that checked the
          // invariant directly instead of assuming it held.
          resolvedAtMs = ackMs;
        }
      }
    }

    supportTickets.push({
      id: ticketId,
      userId: user.id,
      orderId: refs.orderId ?? null,
      returnRequestId: refs.returnRequestId ?? null,
      productId: refs.productId ?? null,
      category,
      subject,
      priority,
      status,
      createdAt: new Date(createdAtMs).toISOString(),
      resolvedAt: resolvedAtMs !== null ? new Date(resolvedAtMs).toISOString() : null,
    });
    for (const m of messages) {
      supportMessages.push({
        id: faker.string.uuid(),
        ticketId,
        sender: m.sender,
        body: m.body,
        timestamp: new Date(m.ms).toISOString(),
      });
    }
  }

  // 1. Delayed shipments -- a real, existing signal (Shipment.delayed).
  for (const shipment of dataset.shipments) {
    if (!shipment.delayed || !rng.chance(0.45)) continue;
    const order = ordersById.get(shipment.orderId);
    if (!order) continue;
    const user = usersById.get(order.userId);
    if (!user) continue;
    const createdAtMs = Math.min(Date.parse(order.createdAt) + rng.int(1, 5) * day, referenceNow);
    pushTicket(
      user,
      createdAtMs,
      "shipping",
      `Delayed delivery -- order #${order.id.slice(0, 8)}`,
      [
        ["high", 60],
        ["urgent", 25],
        ["medium", 15],
      ],
      shippingOpeningMessage(user, order, shipment, rng),
      () => shippingAgentResponse(rng),
      () => shippingResolutionMessage(order, rng),
      { orderId: order.id }
    );
  }

  // 2. Return requests -- grounded in the real reason/refund amount.
  for (const ret of dataset.returnRequests) {
    if (!rng.chance(0.35)) continue;
    const order = ordersById.get(ret.orderId);
    if (!order) continue;
    const user = usersById.get(ret.userId);
    if (!user) continue;
    const createdAtMs = Math.min(Date.parse(ret.requestedAt) + rng.int(0, 3) * day, referenceNow);
    pushTicket(
      user,
      createdAtMs,
      "return",
      `Return status -- order #${order.id.slice(0, 8)}`,
      [
        ["medium", 55],
        ["high", 30],
        ["low", 15],
      ],
      returnOpeningMessage(user, order, ret, rng),
      () => returnAgentResponse(rng),
      () => returnResolutionMessage(ret, rng),
      { orderId: order.id, returnRequestId: ret.id }
    );
  }

  // 3. Low product ratings -- grounded in a real rating <= 2.
  for (const rating of dataset.productRatings) {
    if (rating.rating > 2 || !rng.chance(0.4)) continue;
    const product = productsById.get(rating.productId);
    const user = usersById.get(rating.userId);
    if (!product || !user) continue;
    const createdAtMs = Math.min(Date.parse(rating.createdAt) + rng.int(0, 2) * day, referenceNow);
    pushTicket(
      user,
      createdAtMs,
      "product",
      `Issue with ${product.name}`,
      [
        ["medium", 65],
        ["low", 20],
        ["high", 15],
      ],
      productOpeningMessage(user, product, rating, rng),
      () => productAgentResponse(rng),
      () => productResolutionMessage(rng),
      { productId: product.id }
    );
  }

  // 4. Orders with a missing shipping address -- a real, existing anomaly signal.
  for (const order of dataset.orders) {
    if (order.shippingAddress !== null || !rng.chance(0.5)) continue;
    const user = usersById.get(order.userId);
    if (!user) continue;
    const createdAtMs = Math.min(Date.parse(order.createdAt) + rng.int(0, 1) * day + rng.int(1, 12) * hour, referenceNow);
    pushTicket(
      user,
      createdAtMs,
      "account",
      `Missing shipping address on order #${order.id.slice(0, 8)}`,
      [
        ["high", 70],
        ["urgent", 20],
        ["medium", 10],
      ],
      missingAddressOpeningMessage(order, rng),
      () => missingAddressAgentResponse(rng),
      () => missingAddressResolutionMessage(rng),
      { orderId: order.id }
    );
  }

  // 5. Pre-sales questions -- grounded in a real ProductView for a
  //    product the user never purchased (only when recommendation data
  //    actually exists; skipped entirely otherwise rather than
  //    fabricating browsing history that isn't there).
  if (dataset.productViews.length > 0) {
    const purchasedByUser = new Map<string, Set<string>>();
    for (const order of dataset.orders) {
      const set = purchasedByUser.get(order.userId) ?? new Set<string>();
      for (const item of order.items) set.add(item.productId);
      purchasedByUser.set(order.userId, set);
    }
    for (const view of dataset.productViews) {
      if (!rng.chance(0.05)) continue;
      if (purchasedByUser.get(view.userId)?.has(view.productId)) continue;
      const product = productsById.get(view.productId);
      const user = usersById.get(view.userId);
      if (!product || !user) continue;
      const createdAtMs = Math.min(Date.parse(view.timestamp) + rng.int(0, 6) * hour, referenceNow);
      pushTicket(
        user,
        createdAtMs,
        "general",
        `Question about ${product.name}`,
        [
          ["low", 90],
          ["medium", 10],
        ],
        presalesOpeningMessage(product, rng),
        () => presalesAgentResponse(rng),
        null
      );
    }
  }

  // 6. A small, deliberately modest share of ungrounded generic account
  //    tickets -- real support systems get these too, and forcing every
  //    single ticket to reference a specific bad outcome would itself be
  //    unrealistic in the other direction.
  const genericTicketCount = Math.round(dataset.users.length * 0.01);
  for (let i = 0; i < genericTicketCount; i++) {
    const user = rng.pick(dataset.users);
    const daysAgo = rng.int(0, config.historicalDays);
    const createdAtMs = Math.min(referenceNow - daysAgo * day - rng.int(0, 24) * hour, referenceNow);
    pushTicket(
      user,
      createdAtMs,
      "account",
      "Account question",
      [
        ["low", 85],
        ["medium", 15],
      ],
      genericAccountOpeningMessage(rng),
      () => genericAccountAgentResponse(rng),
      null
    );
  }

  supportTickets.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  supportMessages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  return { supportTickets, supportMessages };
}
