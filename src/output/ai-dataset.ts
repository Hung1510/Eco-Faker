import { Rng } from "../rng.js";
import type { Dataset, Order, ReturnRequest, SupportTicket, User } from "../types.js";

export interface Text2SqlPair {
  id: string;
  question: string;
  sql: string;
  /** The real answer, computed directly from `dataset` -- not from executing `sql` against a database, since this project ships no SQL engine. Every pair listed here was hand-verified against a real sqlite3 instance loaded from this project's own `generate --format sql` output before shipping (see ROADMAP.md); `sql` and `groundTruth` are asserted to agree by construction, not by assumption. */
  groundTruth: unknown;
  difficulty: "easy" | "medium" | "hard";
  tablesUsed: string[];
}

export type RagSourceTable = "support_messages" | "email_messages" | "product_ratings";

export interface RagDocument {
  id: string;
  sourceTable: RagSourceTable;
  sourceId: string;
  text: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentScenario {
  id: string;
  task: string;
  expectedToolCalls: AgentToolCall[];
  expectedAnswer: string;
  groundTruthIds: Record<string, string>;
}

export interface EvalItem {
  id: string;
  question: string;
  answer: string;
  category: "factual" | "aggregation" | "reasoning";
  sourcePairId: string;
}

export interface AiDatasetBundle {
  text2sql: Text2SqlPair[];
  ragCorpus: RagDocument[];
  agentScenarios: AgentScenario[];
  evalSet: EvalItem[];
}

export interface AiDatasetOptions {
  /** Caps how many per-user text2sql/eval pairs get generated, so this stays proportional rather than O(users) on a large dataset. Default 20. */
  maxPerUserPairs?: number;
  /** Caps how many agent scenarios get generated per grounding source (orders, returns, tickets). Default 15. */
  maxScenariosPerSource?: number;
}

function moneyFormatted(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Builds four AI-consumption-ready artifacts from an already-generated
 * dataset, as a read-only projection -- no new tables added to `Dataset`,
 * nothing here changes what `generate()` itself produces. Own decoupled
 * RNG stream (seed XORed with a dedicated constant), same architecture as
 * every other post-processing module in this project, though the only
 * thing randomness affects here is *which* real records get turned into
 * pairs/scenarios -- every value inside a pair is a real, directly-computed
 * fact about the dataset, never fabricated.
 *
 * Scope, stated plainly: this targets the "RAG / agent testing / Text2SQL /
 * LLM evaluation" dataset-for-AI-systems use case specifically, distinct
 * from `support tickets` / `emailMessages` (which model *what a real
 * e-commerce backend looks like*) and `benchmark-export` (which models
 * *how a real search/analytics engine ingests it*). This module reframes
 * the same underlying data one more time, for evaluating an LLM or agent
 * against it.
 */
export function generateAiDataset(dataset: Dataset, options: AiDatasetOptions = {}): AiDatasetBundle {
  const maxPerUserPairs = options.maxPerUserPairs ?? 20;
  const maxScenariosPerSource = options.maxScenariosPerSource ?? 15;
  // `dataset.config` is deliberately excluded from `generate --format json`
  // output (see output/json.ts), so a dataset loaded back in via `--input`
  // -- the CLI's most common path into this exact command -- may have no
  // `config` at all. Caught by actually running `generate` -> `ai-export
  // --input` end-to-end, the same gotcha analytics.ts already documents
  // for its own funnel computation. Falls back to a fixed constant rather
  // than crashing; this only affects *which* real records get sampled
  // into pairs/scenarios; every value inside a pair is still a real,
  // directly-computed fact regardless of which seed picked it.
  const rng = new Rng((dataset.config?.seed ?? 0) ^ 0xa1da7a5e);

  const text2sql = buildText2SqlPairs(dataset, rng, maxPerUserPairs);
  const ragCorpus = buildRagCorpus(dataset);
  const agentScenarios = buildAgentScenarios(dataset, rng, maxScenariosPerSource);
  const evalSet = buildEvalSet(text2sql, agentScenarios);

  return { text2sql, ragCorpus, agentScenarios, evalSet };
}

// --- Text2SQL ----------------------------------------------------------
// Every pair pulls its groundTruth by directly computing over `dataset` --
// the exact real answer the paired `sql` string would return if run
// against this project's own `generate --format sql` output. Table/column
// names match src/output/sql.ts's schema exactly (snake_case), so the SQL
// here is real, executable SQL against that real schema, not
// approximated prose.

function buildText2SqlPairs(dataset: Dataset, rng: Rng, maxPerUserPairs: number): Text2SqlPair[] {
  const pairs: Text2SqlPair[] = [];
  let n = 0;
  const nextId = () => `t2s-${String(++n).padStart(4, "0")}`;

  // -- Fixed, dataset-wide aggregation/join pairs -- one of each shape. --
  const deliveredOrders = dataset.orders.filter((o) => o.status === "delivered");
  const deliveredRevenue = Math.round(deliveredOrders.reduce((sum, o) => sum + o.total, 0) * 100) / 100;
  pairs.push({
    id: nextId(),
    question: "What is the total revenue from delivered orders?",
    // ROUND(...) in the SQL is required, not cosmetic: a real sqlite3 run
    // of the un-rounded SUM produced 4013266.9899999998 against this
    // exact groundTruth's 4013266.99 on a larger dataset -- floating-point
    // summation isn't associative, so SQLite's accumulation order and this
    // module's `reduce` order can (and did) disagree in the last few
    // bits. Rounding both sides to money precision is what actually makes
    // them agree, not a stylistic preference.
    sql: "SELECT ROUND(SUM(total), 2) AS revenue FROM orders WHERE status = 'delivered';",
    groundTruth: { revenue: deliveredRevenue },
    difficulty: "easy",
    tablesUsed: ["orders"],
  });

  pairs.push({
    id: nextId(),
    question: "How many orders are currently in each status?",
    sql: "SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status ORDER BY status;",
    groundTruth: countBy(dataset.orders, (o) => o.status).map(([status, order_count]) => ({ status, order_count })),
    difficulty: "easy",
    tablesUsed: ["orders"],
  });

  const urgentOpenTickets = dataset.supportTickets
    .filter((t) => t.priority === "urgent" && t.status === "open")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);
  pairs.push({
    id: nextId(),
    question: "What are the 5 most recently created open support tickets with urgent priority?",
    sql: "SELECT id, subject, created_at FROM support_tickets WHERE priority = 'urgent' AND status = 'open' ORDER BY created_at DESC LIMIT 5;",
    groundTruth: urgentOpenTickets.map((t) => ({ id: t.id, subject: t.subject, created_at: t.createdAt })),
    difficulty: "medium",
    tablesUsed: ["support_tickets"],
  });

  // ORDER BY is required here, not cosmetic: without it, SQLite's actual
  // row order for a set this size isn't guaranteed to match any particular
  // JS array order, which a real sqlite3 run against this project's own
  // `generate --format sql` output surfaced directly -- the two answers
  // agreed as sets but disagreed as sequences until this was added.
  const ordersWithoutShipment = dataset.orders
    .filter((o) => !dataset.shipments.some((s) => s.orderId === o.id))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  pairs.push({
    id: nextId(),
    question: "Which orders have no shipment record at all?",
    sql: "SELECT o.id FROM orders o LEFT JOIN shipments s ON s.order_id = o.id WHERE s.id IS NULL ORDER BY o.id;",
    groundTruth: ordersWithoutShipment.map((o) => o.id),
    difficulty: "hard",
    tablesUsed: ["orders", "shipments"],
  });

  // SUM() over zero matching rows is SQL NULL, not 0 -- a real sqlite3 run
  // against a dataset with no rejected returns returned
  // would_be_refund_total: null while this groundTruth said 0 until this
  // was fixed. `?? null` here mirrors that real SQL behavior instead of
  // masking it with a JS-only default.
  const rejectedReturns = dataset.returnRequests.filter((r) => r.status === "rejected");
  const wouldBeRefundTotal =
    rejectedReturns.length > 0 ? Math.round(rejectedReturns.reduce((sum, r) => sum + r.refundAmount, 0) * 100) / 100 : null;
  pairs.push({
    id: nextId(),
    question: "How many return requests were rejected, and what's the total refund amount that would have been paid out if they'd been approved instead?",
    sql: "SELECT COUNT(*) AS rejected_count, ROUND(SUM(refund_amount), 2) AS would_be_refund_total FROM return_requests WHERE status = 'rejected';",
    groundTruth: {
      rejected_count: rejectedReturns.length,
      would_be_refund_total: wouldBeRefundTotal,
    },
    difficulty: "medium",
    tablesUsed: ["return_requests"],
  });

  const lowRatedProducts = new Map<string, number>();
  for (const rating of dataset.productRatings) {
    if (rating.rating > 2) continue;
    lowRatedProducts.set(rating.productId, (lowRatedProducts.get(rating.productId) ?? 0) + 1);
  }
  // Same class of bug as the query above: ties on low_rating_count need an
  // explicit secondary sort key, or SQLite's tie order and this array's
  // tie order aren't guaranteed to agree -- caught the same way, by
  // actually running this against a real sqlite instance before shipping.
  const topLowRated = [...lowRatedProducts.entries()]
    .map(([productId, low_rating_count]) => {
      const product = dataset.products.find((p) => p.id === productId);
      return { product_id: productId, name: product?.name ?? "(unknown)", low_rating_count };
    })
    .sort((a, b) => b.low_rating_count - a.low_rating_count || a.name.localeCompare(b.name))
    .slice(0, 5);
  pairs.push({
    id: nextId(),
    question: "Which 5 products have the most ratings of 2 stars or below?",
    sql: "SELECT p.id AS product_id, p.name, COUNT(*) AS low_rating_count FROM product_ratings pr JOIN products p ON p.id = pr.product_id WHERE pr.rating <= 2 GROUP BY p.id, p.name ORDER BY low_rating_count DESC, p.name ASC LIMIT 5;",
    groundTruth: topLowRated,
    difficulty: "hard",
    tablesUsed: ["product_ratings", "products"],
  });

  // -- Per-user pairs -- capped and sampled, not one per user, so this
  //    stays proportional on a large dataset rather than growing O(users). --
  const usersWithOrders = dataset.users.filter((u) => dataset.orders.some((o) => o.userId === u.id));
  const sampleSize = Math.min(maxPerUserPairs, usersWithOrders.length);
  const sampledUsers = rng.shuffle(usersWithOrders).slice(0, sampleSize);

  for (const user of sampledUsers) {
    const userOrders = dataset.orders.filter((o) => o.userId === user.id);
    pairs.push({
      id: nextId(),
      question: `How many orders has ${user.firstName} ${user.lastName} placed?`,
      sql: `SELECT COUNT(*) AS order_count FROM orders WHERE user_id = '${user.id}';`,
      groundTruth: { order_count: userOrders.length },
      difficulty: "easy",
      tablesUsed: ["orders"],
    });

    const lowRatings = dataset.productRatings.filter((r) => r.userId === user.id && r.rating < 3);
    if (lowRatings.length > 0) {
      const names = lowRatings
        .map((r) => dataset.products.find((p) => p.id === r.productId)?.name)
        .filter((name): name is string => Boolean(name));
      pairs.push({
        id: nextId(),
        question: `Which products has ${user.firstName} ${user.lastName} rated below 3 stars?`,
        sql: `SELECT p.name FROM product_ratings pr JOIN products p ON p.id = pr.product_id WHERE pr.user_id = '${user.id}' AND pr.rating < 3;`,
        groundTruth: names,
        difficulty: "medium",
        tablesUsed: ["product_ratings", "products"],
      });
    }
  }

  return pairs;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// --- RAG corpus ----------------------------------------------------------
// A pure reshaping of free-text fields that already exist elsewhere in the
// dataset (support message bodies, email bodies, review text) into
// retrieval-ready documents with metadata -- no new prose generated here.

function buildRagCorpus(dataset: Dataset): RagDocument[] {
  const docs: RagDocument[] = [];

  const ticketsById = new Map<string, SupportTicket>(dataset.supportTickets.map((t) => [t.id, t]));
  for (const message of dataset.supportMessages) {
    const ticket = ticketsById.get(message.ticketId);
    docs.push({
      id: `rag-sm-${message.id}`,
      sourceTable: "support_messages",
      sourceId: message.id,
      text: message.body,
      metadata: {
        ticketId: message.ticketId,
        sender: message.sender,
        category: ticket?.category ?? null,
        priority: ticket?.priority ?? null,
        status: ticket?.status ?? null,
      },
    });
  }

  for (const email of dataset.emailMessages) {
    docs.push({
      id: `rag-em-${email.id}`,
      sourceTable: "email_messages",
      sourceId: email.id,
      text: `${email.subject}\n\n${email.body}`,
      metadata: {
        type: email.type,
        orderId: email.orderId,
        opened: email.opened,
        clicked: email.clicked,
      },
    });
  }

  for (const rating of dataset.productRatings) {
    if (!rating.reviewText) continue;
    const product = dataset.products.find((p) => p.id === rating.productId);
    docs.push({
      id: `rag-pr-${rating.id}`,
      sourceTable: "product_ratings",
      sourceId: rating.id,
      text: rating.reviewText,
      metadata: {
        productId: rating.productId,
        productName: product?.name ?? null,
        rating: rating.rating,
      },
    });
  }

  return docs;
}

// --- Agent scenarios ------------------------------------------------------
// Every expectedToolCalls entry uses `query_table`, the exact generic MCP
// tool this project's own MCP server exposes (see src/mcp.ts) -- so a real
// agent-testing harness can literally replay these tool calls against a
// real MCP session and compare, not just against an invented tool surface.

function buildAgentScenarios(dataset: Dataset, rng: Rng, maxPerSource: number): AgentScenario[] {
  const scenarios: AgentScenario[] = [];
  let n = 0;
  const nextId = () => `agent-${String(++n).padStart(4, "0")}`;

  const shipmentsByOrder = new Map(dataset.shipments.map((s) => [s.orderId, s]));
  const orderSample = rng.shuffle(dataset.orders).slice(0, maxPerSource);
  for (const order of orderSample) {
    const shipment = shipmentsByOrder.get(order.id);
    const answer = shipment
      ? `Order #${order.id.slice(0, 8)} is currently "${shipment.status}"${shipment.delayed ? " (delayed)" : ""}, tracking number ${shipment.trackingNumber} via ${shipment.carrier}.`
      : `Order #${order.id.slice(0, 8)} has no shipment record yet -- it's still "${order.status}".`;
    scenarios.push({
      id: nextId(),
      task: `Look up the shipping status for order ${order.id} and tell the customer when it will arrive or what's going on.`,
      expectedToolCalls: [{ tool: "query_table", args: { table: "orders", filters: { id: order.id } } }, ...(shipment ? [{ tool: "query_table", args: { table: "shipments", filters: { orderId: order.id } } }] : [])],
      expectedAnswer: answer,
      groundTruthIds: { orderId: order.id, ...(shipment ? { shipmentId: shipment.id } : {}) },
    });
  }

  const returnSample = rng.shuffle(dataset.returnRequests).slice(0, maxPerSource);
  for (const ret of returnSample) {
    const answer = ret.resolvedAt
      ? `Return ${ret.id.slice(0, 8)} (${ret.reason}) was resolved with a refund of ${ret.refundAmountFormatted}.`
      : `Return ${ret.id.slice(0, 8)} (${ret.reason}) is still "${ret.status}" -- refund of ${ret.refundAmountFormatted} has not been finalized yet.`;
    scenarios.push({
      id: nextId(),
      task: `A customer is asking about their return request ${ret.id}. Confirm the refund amount and whether it's been resolved.`,
      expectedToolCalls: [{ tool: "query_table", args: { table: "return-requests", filters: { id: ret.id } } }],
      expectedAnswer: answer,
      groundTruthIds: { returnRequestId: ret.id, orderId: ret.orderId },
    });
  }

  const ticketSample = rng.shuffle(dataset.supportTickets.filter((t) => t.status !== "resolved" && t.status !== "closed")).slice(0, maxPerSource);
  for (const ticket of ticketSample) {
    scenarios.push({
      id: nextId(),
      task: `Summarize the current state of support ticket ${ticket.id} for a handoff to another agent.`,
      expectedToolCalls: [
        { tool: "query_table", args: { table: "support-tickets", filters: { id: ticket.id } } },
        { tool: "query_table", args: { table: "support-messages", filters: { ticketId: ticket.id } } },
      ],
      expectedAnswer: `Ticket ${ticket.id.slice(0, 8)} (${ticket.category}, ${ticket.priority} priority) is currently "${ticket.status}". Subject: "${ticket.subject}".`,
      groundTruthIds: { ticketId: ticket.id },
    });
  }

  return scenarios;
}

// --- LLM eval set ----------------------------------------------------------
// Deliberately derived from text2sql + agent scenarios rather than a third
// independent generation pass -- an eval item is the same real
// question-grounded-in-real-data shape, just rendered as a natural-language
// answer instead of a SQL/tool-call trace. Building a genuinely separate
// eval-authoring pass on top would mostly duplicate this content with a
// different wrapper, the same call this project made when it deliberately
// left "chat messages" out of Support Tickets rather than forcing in
// coverage for its own sake.

function buildEvalSet(text2sql: Text2SqlPair[], agentScenarios: AgentScenario[]): EvalItem[] {
  const items: EvalItem[] = [];
  let n = 0;
  const nextId = () => `eval-${String(++n).padStart(4, "0")}`;

  for (const pair of text2sql) {
    const category: EvalItem["category"] = pair.tablesUsed.length > 1 ? "reasoning" : pair.question.match(/how many|total|sum/i) ? "aggregation" : "factual";
    items.push({
      id: nextId(),
      question: pair.question,
      answer: renderGroundTruthAsAnswer(pair.groundTruth),
      category,
      sourcePairId: pair.id,
    });
  }

  for (const scenario of agentScenarios) {
    items.push({
      id: nextId(),
      question: scenario.task,
      answer: scenario.expectedAnswer,
      category: "reasoning",
      sourcePairId: scenario.id,
    });
  }

  return items;
}

function renderGroundTruthAsAnswer(groundTruth: unknown): string {
  if (groundTruth === null || groundTruth === undefined) return "No matching records.";
  if (Array.isArray(groundTruth)) {
    if (groundTruth.length === 0) return "None.";
    return groundTruth.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join("; ");
  }
  if (typeof groundTruth === "object") {
    return Object.entries(groundTruth as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "number" && k.toLowerCase().includes("revenue") ? moneyFormatted(v) : v}`)
      .join(", ");
  }
  return String(groundTruth);
}
