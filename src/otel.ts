import type { Faker } from "@faker-js/faker";
import { Rng } from "./rng.js";
import type { Dataset, Order, Shipment } from "./types.js";

// Verified against the real OTLP/JSON wire format (opentelemetry-proto's
// trace.proto, canonical JSON mapping): span `kind` and `status.code` are
// plain integers, not string enum names, and nanosecond timestamps are
// string-encoded (a real uint64 nanosecond value exceeds JS's safe
// integer range). See README's "OpenTelemetry export" section for the
// verification source.
const SPAN_KIND = { UNSPECIFIED: 0, INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 } as const;
const STATUS_CODE = { UNSET: 0, OK: 1, ERROR: 2 } as const;

interface OtelAttribute {
  key: string;
  value: { stringValue?: string } | { intValue?: string } | { doubleValue?: number } | { boolValue?: boolean };
}

interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtelAttribute[];
  status: { code: number; message?: string };
}

interface OtlpJson {
  resourceSpans: {
    resource: { attributes: OtelAttribute[] };
    scopeSpans: { scope: { name: string }; spans: OtelSpan[] }[];
  }[];
}

export interface OtelExportResult {
  otlp: OtlpJson;
  traceCount: number;
  spanCount: number;
}

const NS_PER_MS = 1_000_000;

function attr(key: string, value: string | number | boolean): OtelAttribute {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  // OTLP's AnyValue has distinct intValue and doubleValue types --
  // routing every number through intValue (rounding it) silently
  // truncated the cents off every dollar-amount attribute (order.total,
  // payment.amount, tax, subtotal), which is exactly the kind of
  // precision loss that matters for money in a trace. Whole numbers
  // (item counts, etc.) still use intValue.
  if (Number.isInteger(value)) return { key, value: { intValue: String(value) } };
  return { key, value: { doubleValue: value } };
}

function nano(ms: number): string {
  return String(Math.round(ms * NS_PER_MS));
}

function newId(faker: Faker, byteLength: 16 | 8): string {
  return faker.string.hexadecimal({ length: byteLength * 2, casing: "lower", prefix: "" });
}

function slug(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Builds one "fulfill_shipment" trace per shipment, entirely grounded in
 * real data: the root span spans the shipment's own first-to-last real
 * tracking-event timestamps, and every child span corresponds to a real
 * consecutive pair of tracking events (not a synthetic breakdown) --
 * "in_transit", "out_for_delivery", and so on, each spanning exactly the
 * real time between those two real events. A shipment's real `delayed`
 * flag surfaces as a real ERROR status on its "in_transit" span, not a
 * fabricated failure.
 */
function buildFulfillmentSpans(faker: Faker, shipment: Shipment, traceId: string): OtelSpan[] {
  if (shipment.events.length === 0) return [];
  const spans: OtelSpan[] = [];
  const rootSpanId = newId(faker, 8);
  const first = shipment.events[0];
  const last = shipment.events[shipment.events.length - 1];

  spans.push({
    traceId,
    spanId: rootSpanId,
    name: "fulfill_shipment",
    kind: SPAN_KIND.INTERNAL,
    startTimeUnixNano: nano(Date.parse(first.timestamp)),
    endTimeUnixNano: nano(Date.parse(last.timestamp)),
    attributes: [
      attr("shipment.id", shipment.id),
      attr("shipment.order_id", shipment.orderId),
      attr("shipment.carrier", shipment.carrier),
      attr("shipment.tracking_number", shipment.trackingNumber),
      attr("shipment.delayed", shipment.delayed),
    ],
    status: { code: shipment.delayed ? STATUS_CODE.ERROR : STATUS_CODE.OK },
  });

  for (let i = 0; i < shipment.events.length - 1; i++) {
    const from = shipment.events[i];
    const to = shipment.events[i + 1];
    const isDelayStage = shipment.delayed && from.status === "In Transit";
    spans.push({
      traceId,
      spanId: newId(faker, 8),
      parentSpanId: rootSpanId,
      name: slug(to.status),
      kind: SPAN_KIND.INTERNAL,
      startTimeUnixNano: nano(Date.parse(from.timestamp)),
      endTimeUnixNano: nano(Date.parse(to.timestamp)),
      attributes: [attr("tracking.location", to.location), attr("tracking.status", to.status)],
      status: { code: isDelayStage ? STATUS_CODE.ERROR : STATUS_CODE.OK, message: isDelayStage ? "carrier delay" : undefined },
    });
  }

  return spans;
}

/**
 * Builds one "checkout" trace per order, spanning two real OTLP
 * resources/services (checkout-service and payment-service) sharing the
 * same traceId -- a genuine multi-service trace shape, not one flat
 * service. The root span's end time is the order's real `createdAt`;
 * its total duration is a plausible synthetic figure (there is no real
 * per-order "how long did checkout take" signal anywhere in this dataset
 * to ground it against -- disclosed here rather than presented as
 * derived from something real, the same honesty this project applied to
 * CAC's assumed marketing spend). What IS grounded: the payment span's
 * error status, which reflects the order's real fraud tag when one
 * exists -- specifically `stolen_card`, the one fraud type that
 * genuinely corresponds to a payment-declined scenario.
 */
function buildCheckoutSpans(
  faker: Faker,
  rng: Rng,
  order: Order,
  traceId: string
): { checkoutServiceSpans: OtelSpan[]; paymentServiceSpans: OtelSpan[] } {
  const endMs = Date.parse(order.createdAt);
  const totalDurationMs = rng.int(400, 2200);
  const startMs = endMs - totalDurationMs;
  const rootSpanId = newId(faker, 8);

  const checkoutServiceSpans: OtelSpan[] = [
    {
      traceId,
      spanId: rootSpanId,
      name: "checkout",
      kind: SPAN_KIND.SERVER,
      startTimeUnixNano: nano(startMs),
      endTimeUnixNano: nano(endMs),
      attributes: [attr("order.id", order.id), attr("order.total", order.total), attr("order.currency", order.currency)],
      status: { code: STATUS_CODE.OK },
    },
  ];

  let cursor = startMs;
  const step = (fraction: number) => Math.round(totalDurationMs * fraction);

  const validateEnd = cursor + step(0.15);
  checkoutServiceSpans.push({
    traceId,
    spanId: newId(faker, 8),
    parentSpanId: rootSpanId,
    name: "validate_cart",
    kind: SPAN_KIND.INTERNAL,
    startTimeUnixNano: nano(cursor),
    endTimeUnixNano: nano(validateEnd),
    attributes: [attr("cart.id", order.cartId), attr("cart.item_count", order.items.length)],
    status: { code: STATUS_CODE.OK },
  });
  cursor = validateEnd;

  const taxEnd = cursor + step(0.1);
  checkoutServiceSpans.push({
    traceId,
    spanId: newId(faker, 8),
    parentSpanId: rootSpanId,
    name: "calculate_tax",
    kind: SPAN_KIND.INTERNAL,
    startTimeUnixNano: nano(cursor),
    endTimeUnixNano: nano(taxEnd),
    attributes: [attr("order.tax", order.tax), attr("order.subtotal", order.subtotal)],
    status: { code: STATUS_CODE.OK },
  });
  cursor = taxEnd;

  // Payment: a different OTLP resource (payment-service), same traceId --
  // the real, standard way a multi-service trace is represented in OTLP.
  const paymentEnd = cursor + step(0.5);
  const isDeclinedFraud = order.fraud?.fraudType === "stolen_card";
  const paymentServiceSpans: OtelSpan[] = [
    {
      traceId,
      spanId: newId(faker, 8),
      parentSpanId: rootSpanId,
      name: "charge_payment",
      kind: SPAN_KIND.CLIENT,
      startTimeUnixNano: nano(cursor),
      endTimeUnixNano: nano(paymentEnd),
      attributes: [
        attr("payment.amount", order.total),
        attr("payment.currency", order.currency),
        ...(order.fraud ? [attr("fraud.type", order.fraud.fraudType)] : []),
      ],
      status: isDeclinedFraud ? { code: STATUS_CODE.ERROR, message: "card declined" } : { code: STATUS_CODE.OK },
    },
  ];
  cursor = paymentEnd;

  checkoutServiceSpans.push({
    traceId,
    spanId: newId(faker, 8),
    parentSpanId: rootSpanId,
    name: "reserve_inventory",
    kind: SPAN_KIND.INTERNAL,
    startTimeUnixNano: nano(cursor),
    endTimeUnixNano: nano(Math.min(cursor + step(0.25), endMs)),
    attributes: order.items.map((item: Order["items"][number]) => attr("product.id", item.productId)).slice(0, 5),
    status: { code: STATUS_CODE.OK },
  });

  return { checkoutServiceSpans, paymentServiceSpans };
}

/**
 * Generates a real, valid OTLP/JSON trace export from an already-
 * generated dataset -- two kinds of traces, both grounded in real data
 * rather than fabricated wholesale: "fulfill_shipment" (spans exactly
 * matching each shipment's real tracking-event timeline) and "checkout"
 * (spanning two real OTLP resources, checkout-service and
 * payment-service, sharing one traceId -- a genuine multi-service trace,
 * with the payment span's error status reflecting the order's real
 * fraud tag). Not built on the real OTel Node SDK: that SDK is designed
 * around instrumenting live code in real time (start a span now, do
 * work, end it now), not around specifying thousands of arbitrary past
 * timestamps, so this constructs the wire format directly instead --
 * the same choice this project made for the Elasticsearch Bulk API
 * format, for the same reason.
 */
export function generateOtelExport(faker: Faker, seed: number, dataset: Dataset): OtelExportResult {
  const rng = new Rng(seed);
  const checkoutServiceSpans: OtelSpan[] = [];
  const paymentServiceSpans: OtelSpan[] = [];
  const fulfillmentServiceSpans: OtelSpan[] = [];
  let traceCount = 0;

  for (const order of dataset.orders) {
    const traceId = newId(faker, 16);
    const { checkoutServiceSpans: cs, paymentServiceSpans: ps } = buildCheckoutSpans(faker, rng, order, traceId);
    checkoutServiceSpans.push(...cs);
    paymentServiceSpans.push(...ps);
    traceCount++;
  }

  for (const shipment of dataset.shipments) {
    const traceId = newId(faker, 16);
    const spans = buildFulfillmentSpans(faker, shipment, traceId);
    if (spans.length === 0) continue;
    fulfillmentServiceSpans.push(...spans);
    traceCount++;
  }

  const resourceSpans: OtlpJson["resourceSpans"] = [
    {
      resource: { attributes: [attr("service.name", "checkout-service")] },
      scopeSpans: [{ scope: { name: "eco-faker" }, spans: checkoutServiceSpans }],
    },
    {
      resource: { attributes: [attr("service.name", "payment-service")] },
      scopeSpans: [{ scope: { name: "eco-faker" }, spans: paymentServiceSpans }],
    },
    {
      resource: { attributes: [attr("service.name", "fulfillment-service")] },
      scopeSpans: [{ scope: { name: "eco-faker" }, spans: fulfillmentServiceSpans }],
    },
  ];

  const spanCount = checkoutServiceSpans.length + paymentServiceSpans.length + fulfillmentServiceSpans.length;
  return { otlp: { resourceSpans }, traceCount, spanCount };
}
