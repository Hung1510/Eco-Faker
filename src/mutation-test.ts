import type { OpenApiDocument } from "./contract-test.js";

export type MutationCheckKind = "not_found" | "unauthorized" | "duplicate_submission" | "race_condition" | "invalid_transition";

export interface MutationCheckResult {
  check: MutationCheckKind;
  method: string;
  path: string;
  ok: boolean;
  detail: string;
  error?: string;
}

export interface MutationTestOptions {
  baseUrl: string;
  contract: OpenApiDocument;
  /**
   * Real request bodies for POST operations, keyed by the exact collection
   * path template (e.g. "/api/orders"). A path with no seed body here is
   * skipped for `duplicate_submission`/`race_condition` with a clear
   * `error`, never silently faked -- see `buildSeedBodiesFromDataset` for
   * the usual way to build this from a real eco-faker dataset.
   */
  seedBodies?: Record<string, Record<string, unknown>>;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  /** Concurrent identical requests fired for the race-condition check. Default 5. */
  concurrency?: number;
  /** Header used to signal request-level idempotency. Sent identically across the repeated/concurrent requests in the duplicate-submission and race-condition checks. Default "Idempotency-Key". */
  idempotencyHeader?: string;
  /** Field name checked for an ordered status enum when auto-detecting invalid transitions. Default "status". */
  statusField?: string;
}

export interface MutationTestSummary {
  results: MutationCheckResult[];
  passed: number;
  failed: number;
}

interface ResolvedOperation {
  method: string;
  pathTemplate: string;
  operation: {
    parameters?: { name: string; in: string; required?: boolean }[];
    responses?: Record<string, { content?: { "application/json"?: { schema?: object } } }>;
    requestBody?: { content?: { "application/json"?: { schema?: object } } };
  };
}

function declaredCodes(op: ResolvedOperation["operation"]): string[] {
  return Object.keys(op.responses ?? {});
}

function schemaRefName(schema: object | undefined): string | undefined {
  if (!schema) return undefined;
  const s = schema as { $ref?: string; items?: { $ref?: string }; oneOf?: { $ref?: string }[] };
  const ref = s.$ref ?? s.items?.$ref ?? s.oneOf?.find((o) => o.$ref)?.$ref;
  return ref?.split("/").pop();
}

/** A syntactically-plausible UUID that's astronomically unlikely to exist in any real dataset -- used for the not_found check without needing to know the server's real id space. */
function fabricatedId(): string {
  return "ffffffff-ffff-4fff-8fff-ffffffffffff";
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** A response body's own `id`, whether it's returned bare (`{id, ...}`) or wrapped (`{data: {id, ...}}`) -- both are common REST conventions and this tool targets arbitrary real backends, not just eco-faker's own shape. */
function extractId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;
  if (typeof obj.id === "string") return obj.id;
  if (obj.data && typeof obj.data === "object") {
    const inner = (obj.data as Record<string, unknown>).id;
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

/** A list response's records, whether returned as a bare array or wrapped `{data: [...]}` -- see extractId's reasoning. */
function extractList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).data)) {
    return (body as { data: unknown[] }).data as Record<string, unknown>[];
  }
  return [];
}

/**
 * Fires real mutating requests against `baseUrl` -- the stateful half of
 * contract testing explicitly left unbuilt when `runContractTest` shipped
 * (see ROADMAP.md). Distinct scope from that read-path engine: this one
 * targets exactly the checks that only show up once you write, not just
 * read -- idempotency, concurrent duplicate creation, and status
 * transitions a real state machine should reject.
 *
 * `invalid_transition` is genuinely automatic, not configured by hand:
 * any schema in `contract.components.schemas` with an ordered `enum` on
 * its status field (`orders.status: [processing, shipped, delivered]`,
 * exactly how this project's own `openapi.ts` already declares it) is
 * enough to attempt a backward transition and assert it's rejected --
 * no separate state-machine description has to be authored for this tool
 * to check it, because OpenAPI's own enum ordering already carries that
 * information for any contract that declares one.
 *
 * `duplicate_submission`/`race_condition` require a real seed body (see
 * `seedBodies`) -- there's no way to fire a realistic POST without one,
 * and fabricating one would test something other than the real contract.
 * A POST path with no seed body is skipped with a clear reason, the same
 * principle `runContractTest` already applies to a byId path with no
 * sample id.
 */
export async function runMutationTest(options: MutationTestOptions): Promise<MutationTestSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const headers = options.headers ?? {};
  const concurrency = options.concurrency ?? 5;
  const idempotencyHeader = options.idempotencyHeader ?? "Idempotency-Key";
  const statusField = options.statusField ?? "status";
  const schemas = options.contract.components?.schemas ?? {};
  const seedBodies = options.seedBodies ?? {};

  const results: MutationCheckResult[] = [];
  const entries = Object.entries(options.contract.paths ?? {});

  // -- not_found: any operation declaring 404, fired at a fabricated id. --
  for (const [pathTemplate, operations] of entries) {
    if (!pathTemplate.includes("{")) continue;
    for (const [method, operation] of Object.entries(operations)) {
      const codes = declaredCodes(operation);
      if (!codes.includes("404")) continue;
      const requestPath = pathTemplate.replace(/\{[^}]+\}/, fabricatedId());
      const requestUrl = `${baseUrl}${requestPath}`;
      try {
        const res = await fetchImpl(requestUrl, { method: method.toUpperCase(), headers });
        results.push({
          check: "not_found",
          method: method.toUpperCase(),
          path: pathTemplate,
          ok: res.status === 404,
          detail: res.status === 404 ? "returned 404 for a fabricated id, as declared" : `returned ${res.status} for a fabricated id instead of the declared 404`,
        });
      } catch (err) {
        results.push({ check: "not_found", method: method.toUpperCase(), path: pathTemplate, ok: false, detail: "request failed", error: (err as Error).message });
      }
    }
  }

  // -- unauthorized: any operation declaring 401, fired with no auth headers at all. --
  for (const [pathTemplate, operations] of entries) {
    for (const [method, operation] of Object.entries(operations)) {
      const codes = declaredCodes(operation);
      if (!codes.includes("401")) continue;
      const requestPath = pathTemplate.replace(/\{[^}]+\}/, fabricatedId());
      const requestUrl = `${baseUrl}${requestPath}`;
      try {
        const res = await fetchImpl(requestUrl, { method: method.toUpperCase() }); // deliberately no headers
        results.push({
          check: "unauthorized",
          method: method.toUpperCase(),
          path: pathTemplate,
          ok: res.status === 401,
          detail: res.status === 401 ? "returned 401 with no auth header, as declared" : `returned ${res.status} with no auth header instead of the declared 401`,
        });
      } catch (err) {
        results.push({ check: "unauthorized", method: method.toUpperCase(), path: pathTemplate, ok: false, detail: "request failed", error: (err as Error).message });
      }
    }
  }

  // -- duplicate_submission + race_condition: POST paths with a real seed body. --
  for (const [pathTemplate, operations] of entries) {
    if (pathTemplate.includes("{")) continue;
    const operation = operations.post;
    if (!operation?.requestBody) continue;
    const body = seedBodies[pathTemplate];
    if (!body) {
      results.push({
        check: "duplicate_submission",
        method: "POST",
        path: pathTemplate,
        ok: false,
        detail: "skipped",
        error: `no seed body supplied for ${pathTemplate} -- pass one in seedBodies, e.g. via buildSeedBodiesFromDataset`,
      });
      continue;
    }

    const idempotencyKey = `mut-test-${Math.random().toString(36).slice(2)}`;
    const post = () =>
      fetchImpl(`${baseUrl}${pathTemplate}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", [idempotencyHeader]: idempotencyKey },
        body: JSON.stringify(body),
      });

    try {
      const first = await post();
      const firstId = extractId(await readJson(first));
      const second = await post();
      const secondId = extractId(await readJson(second));
      const ok = firstId !== undefined && firstId === secondId;
      results.push({
        check: "duplicate_submission",
        method: "POST",
        path: pathTemplate,
        ok,
        detail: ok
          ? `two identical POSTs with the same ${idempotencyHeader} returned the same resource (${firstId})`
          : `two identical POSTs with the same ${idempotencyHeader} returned different ids (${firstId ?? "(none)"} vs ${secondId ?? "(none)"}) -- looks like it created a duplicate resource`,
      });
    } catch (err) {
      results.push({ check: "duplicate_submission", method: "POST", path: pathTemplate, ok: false, detail: "request failed", error: (err as Error).message });
    }

    try {
      const raceKey = `mut-test-race-${Math.random().toString(36).slice(2)}`;
      const raceBody = JSON.stringify(body);
      const responses = await Promise.all(
        Array.from({ length: concurrency }, () =>
          fetchImpl(`${baseUrl}${pathTemplate}`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json", [idempotencyHeader]: raceKey },
            body: raceBody,
          })
        )
      );
      const ids = new Set<string>();
      for (const res of responses) {
        const id = extractId(await readJson(res));
        if (id) ids.add(id);
      }
      const ok = ids.size <= 1;
      results.push({
        check: "race_condition",
        method: "POST",
        path: pathTemplate,
        ok,
        detail: ok
          ? `${concurrency} concurrent identical POSTs with the same ${idempotencyHeader} resolved to a single resource`
          : `${concurrency} concurrent identical POSTs with the same ${idempotencyHeader} created ${ids.size} distinct resources instead of 1`,
      });
    } catch (err) {
      results.push({ check: "race_condition", method: "POST", path: pathTemplate, ok: false, detail: "request failed", error: (err as Error).message });
    }
  }

  // -- invalid_transition: auto-detected from ordered status enums on any schema referenced by a byId GET/PATCH/PUT. --
  for (const [pathTemplate, operations] of entries) {
    const idMatch = pathTemplate.match(/^(.*)\/\{[^}]+\}$/);
    if (!idMatch) continue;
    const writeMethod = (["patch", "put"] as const).find((m) => operations[m]);
    if (!writeMethod) continue;
    const readOp = operations.get ?? operations[writeMethod];
    const successEntry = Object.entries(readOp.responses ?? {}).find(([code]) => code.startsWith("2"));
    const schemaName = successEntry ? schemaRefName(successEntry[1]?.content?.["application/json"]?.schema) : undefined;
    const schema = schemaName ? (schemas[schemaName] as { properties?: Record<string, { type?: string; enum?: string[] }> } | undefined) : undefined;
    const statusProp = schema?.properties?.[statusField];
    if (!statusProp || statusProp.type !== "string" || !statusProp.enum || statusProp.enum.length < 2) continue;

    const listUrl = `${baseUrl}${idMatch[1]}`;
    try {
      const listRes = await fetchImpl(listUrl, { headers });
      const records = extractList(await readJson(listRes));
      const sample = records[0];
      const sampleId = sample && typeof sample.id === "string" ? sample.id : undefined;
      const currentStatus = sample?.[statusField];
      if (!sampleId || typeof currentStatus !== "string") {
        results.push({
          check: "invalid_transition",
          method: writeMethod.toUpperCase(),
          path: pathTemplate,
          ok: false,
          detail: "skipped",
          error: `no sample record with a "${statusField}" available from ${idMatch[1]} to test a transition on`,
        });
        continue;
      }
      const currentIndex = statusProp.enum.indexOf(currentStatus);
      if (currentIndex <= 0) {
        // Already at (or before) the earliest enum value -- nothing "backward" to attempt.
        continue;
      }
      const target = statusProp.enum[0];
      const requestUrl = `${baseUrl}${pathTemplate.replace(/\{[^}]+\}$/, sampleId)}`;
      const res = await fetchImpl(requestUrl, {
        method: writeMethod.toUpperCase(),
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ [statusField]: target }),
      });
      const ok = res.status >= 400 && res.status < 500;
      results.push({
        check: "invalid_transition",
        method: writeMethod.toUpperCase(),
        path: pathTemplate,
        ok,
        detail: ok
          ? `rejected ${currentStatus} -> ${target} with ${res.status}, as a real state machine should`
          : `allowed ${currentStatus} -> ${target} with ${res.status} -- a backward transition on "${statusField}" that a real state machine should reject`,
      });
    } catch (err) {
      results.push({ check: "invalid_transition", method: writeMethod.toUpperCase(), path: pathTemplate, ok: false, detail: "request failed", error: (err as Error).message });
    }
  }

  return { results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

/**
 * Builds seed POST bodies for `runMutationTest` from a real eco-faker
 * dataset -- best-effort, table-name matching: the collection path's last
 * segment (kebab/snake converted to camelCase) is looked up directly
 * against the dataset's own array keys (e.g. `/api/orders` -> `orders`).
 * A path that doesn't match any real table is left out, not filled with
 * a fabricated placeholder -- the caller can always pass an explicit
 * `seedBodies` entry for anything this heuristic misses.
 */
export function buildSeedBodiesFromDataset(
  dataset: Record<string, unknown>,
  contract: OpenApiDocument
): Record<string, Record<string, unknown>> {
  const seedBodies: Record<string, Record<string, unknown>> = {};
  for (const pathTemplate of Object.keys(contract.paths ?? {})) {
    if (pathTemplate.includes("{")) continue;
    const lastSegment = pathTemplate.split("/").filter(Boolean).pop();
    if (!lastSegment) continue;
    const camelKey = lastSegment.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const table = dataset[camelKey];
    if (!Array.isArray(table) || table.length === 0) continue;
    const record = table[Math.floor(Math.random() * table.length)] as Record<string, unknown>;
    const { id, ...rest } = record;
    seedBodies[pathTemplate] = rest;
  }
  return seedBodies;
}
