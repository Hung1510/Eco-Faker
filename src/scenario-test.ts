export interface ScenarioStep {
  /** Human-readable name, also the namespace later steps use to reference this step's captured values (`{{stepName.field}}`). */
  name: string;
  method: string;
  /** May contain `{{stepName.field}}` or `{{seed.field}}` placeholders, resolved against earlier steps' captured values and any seed data supplied. */
  path: string;
  /** May contain the same placeholders in any string leaf value, at any depth. */
  body?: Record<string, unknown>;
  /** Accepted status code(s) for this step. Default: any 2xx. A step that's *supposed* to be rejected (cancel-after-ship, say) declares its real expected rejection code here, e.g. 409 -- that's a pass, not a failure. */
  expectStatus?: number | number[];
  /** Shallow field-equality assertions against the real response body (dot-path per field, e.g. "data.status"). This is the actual "business logic outcome," not just the HTTP code -- a step can return the "right" status with the wrong resulting state. */
  expectBody?: Record<string, unknown>;
  /** localName -> dot-path into this step's response body. Captured values are stored under `variables[step.name][localName]`, referenced by later steps as `{{stepName.localName}}`. */
  capture?: Record<string, string>;
}

export interface Scenario {
  name: string;
  steps: ScenarioStep[];
}

export interface ScenarioStepResult {
  step: string;
  method: string;
  /** The path actually requested, after template substitution. */
  requestPath: string;
  ok: boolean;
  statusActual: number | null;
  statusExpected: number[];
  bodyMismatches?: string[];
  /** Placeholders in the path or body that never resolved to a real value -- always a real problem (a typo'd step name, a capture that never ran because an earlier step failed differently than expected), never silently swallowed. */
  unresolvedPlaceholders?: string[];
  error?: string;
}

export interface ScenarioTestOptions {
  baseUrl: string;
  scenario: Scenario;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  /** Available as `{{seed.*}}` in any step's path/body -- typically a real eco-faker dataset (`{{seed.users.0.id}}`), so a step needing a real userId/productId doesn't need one hand-typed into the scenario file. */
  seedVariables?: Record<string, unknown>;
}

export interface ScenarioTestResult {
  scenarioName: string;
  steps: ScenarioStepResult[];
  passed: number;
  failed: number;
  /** True if a step failed and every step after it was skipped -- a later step referencing a value the failed step should have produced has nothing real to inject, so continuing wouldn't test anything meaningful. */
  stoppedEarly: boolean;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Simple `a.b.0.c`-style path resolution over a plain object/array -- numeric segments index into arrays, everything else is an object-key lookup. Returns `undefined` for anything that doesn't resolve, never throws. */
export function resolveDotPath(obj: unknown, dotPath: string): unknown {
  if (dotPath === "") return obj;
  return dotPath.split(".").reduce((acc: unknown, segment) => {
    if (acc === undefined || acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[segment];
  }, obj);
}

/**
 * Substitutes every `{{scope.rest.of.path}}` placeholder in `text` against
 * `variables[scope]`, resolving `rest.of.path` with `resolveDotPath`. An
 * unresolved placeholder is left exactly as written (not replaced with the
 * string "undefined") and reported back via `unresolved`, so a typo'd step
 * name or a reference to a step that never ran surfaces as a visible,
 * specific problem in the step result -- not a silently broken URL/body
 * that then fails for a confusing, unrelated reason two layers down.
 */
export function substituteTemplates(text: string, variables: Record<string, unknown>, unresolved: Set<string>): string {
  return text.replace(PLACEHOLDER_PATTERN, (match, expr: string) => {
    const dotIndex = expr.indexOf(".");
    const scope = dotIndex === -1 ? expr : expr.slice(0, dotIndex);
    const rest = dotIndex === -1 ? "" : expr.slice(dotIndex + 1);
    if (!(scope in variables)) {
      unresolved.add(match);
      return match;
    }
    const resolved = resolveDotPath(variables[scope], rest);
    if (resolved === undefined) {
      unresolved.add(match);
      return match;
    }
    return String(resolved);
  });
}

function substituteInValue(value: unknown, variables: Record<string, unknown>, unresolved: Set<string>): unknown {
  if (typeof value === "string") return substituteTemplates(value, variables, unresolved);
  if (Array.isArray(value)) return value.map((v) => substituteInValue(v, variables, unresolved));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteInValue(v, variables, unresolved)]));
  }
  return value;
}

/**
 * Fires a strict, ordered sequence of real mutating requests -- create a
 * cart, convert it to an order, ship it, attempt an illegal cancel
 * (expecting a real rejection), request a return -- threading real ids
 * captured from each response into the next step's URL/body. This is the
 * cross-resource half `runMutationTest` explicitly left unbuilt: that
 * engine fires one mutating request per check, independent of any other;
 * this one fires a whole real business workflow and checks the outcome at
 * every stage, not just the HTTP status of the last request.
 *
 * Deliberately does not also validate each step's response against the
 * OpenAPI contract's declared schema (the way `runContractTest` does for
 * reads) -- mapping a resolved request path with real ids substituted in
 * back to the contract's own templated path (`/api/orders/{id}`) to look
 * up the right schema is a real piece of work on its own, and
 * `expectStatus`/`expectBody` already cover the actual point of this
 * engine (the business-logic outcome at each stage), so that's left as a
 * stated future enhancement rather than bolted on to get to a nominally
 * more complete v1.
 */
export async function runScenarioTest(options: ScenarioTestOptions): Promise<ScenarioTestResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const variables: Record<string, unknown> = { seed: options.seedVariables ?? {} };

  const results: ScenarioStepResult[] = [];
  let stoppedEarly = false;

  for (const step of options.scenario.steps) {
    const unresolved = new Set<string>();
    const requestPath = substituteTemplates(step.path, variables, unresolved);
    const requestBody = step.body ? (substituteInValue(step.body, variables, unresolved) as Record<string, unknown>) : undefined;
    const expectedStatuses = step.expectStatus === undefined ? undefined : Array.isArray(step.expectStatus) ? step.expectStatus : [step.expectStatus];

    if (unresolved.size > 0) {
      results.push({
        step: step.name,
        method: step.method.toUpperCase(),
        requestPath,
        ok: false,
        statusActual: null,
        statusExpected: expectedStatuses ?? [],
        unresolvedPlaceholders: [...unresolved],
        error: `unresolved placeholder(s): ${[...unresolved].join(", ")} -- check the referenced step name/field, or that an earlier step's "capture" actually produced it`,
      });
      stoppedEarly = true;
      break;
    }

    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${requestPath}`, {
        method: step.method.toUpperCase(),
        headers: { ...options.headers, ...(requestBody ? { "Content-Type": "application/json" } : {}) },
        body: requestBody ? JSON.stringify(requestBody) : undefined,
      });
    } catch (err) {
      results.push({
        step: step.name,
        method: step.method.toUpperCase(),
        requestPath,
        ok: false,
        statusActual: null,
        statusExpected: expectedStatuses ?? [],
        error: `request failed: ${(err as Error).message}`,
      });
      stoppedEarly = true;
      break;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }

    const statusOk = expectedStatuses ? expectedStatuses.includes(res.status) : res.status >= 200 && res.status < 300;

    const bodyMismatches: string[] = [];
    if (step.expectBody) {
      for (const [field, expected] of Object.entries(step.expectBody)) {
        const actual = resolveDotPath(body, field);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          bodyMismatches.push(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      }
    }

    if (step.capture) {
      const captured: Record<string, unknown> = {};
      for (const [localName, dotPath] of Object.entries(step.capture)) {
        captured[localName] = resolveDotPath(body, dotPath);
      }
      variables[step.name] = captured;
    }

    const ok = statusOk && bodyMismatches.length === 0;
    results.push({
      step: step.name,
      method: step.method.toUpperCase(),
      requestPath,
      ok,
      statusActual: res.status,
      statusExpected: expectedStatuses ?? [200, 201, 202, 204],
      bodyMismatches: bodyMismatches.length > 0 ? bodyMismatches : undefined,
    });

    if (!ok) {
      stoppedEarly = true;
      break;
    }
  }

  return {
    scenarioName: options.scenario.name,
    steps: results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    stoppedEarly,
  };
}

/** Structural validation for a loaded scenario file -- every step needs at least a name/method/path, and step names must be unique (later steps reference them by name; a duplicate would make a capture reference ambiguous about which step it means). */
export function validateScenario(scenario: unknown): string[] {
  const errors: string[] = [];
  if (!scenario || typeof scenario !== "object") {
    return ["scenario must be an object with \"name\" and \"steps\""];
  }
  const s = scenario as Partial<Scenario>;
  if (!s.name || typeof s.name !== "string") errors.push('scenario is missing a "name" string');
  if (!Array.isArray(s.steps) || s.steps.length === 0) {
    errors.push('scenario must have a non-empty "steps" array');
    return errors;
  }
  const seenNames = new Set<string>();
  s.steps.forEach((step, i) => {
    if (!step || typeof step !== "object") {
      errors.push(`step ${i}: must be an object`);
      return;
    }
    const st = step as Partial<ScenarioStep>;
    if (!st.name || typeof st.name !== "string") errors.push(`step ${i}: missing a "name" string`);
    else if (seenNames.has(st.name)) errors.push(`step ${i}: duplicate step name "${st.name}" -- step names must be unique, later steps reference earlier ones by name`);
    else seenNames.add(st.name);
    if (!st.method || typeof st.method !== "string") errors.push(`step ${i} ("${st.name ?? "?"}"): missing a "method" string`);
    if (!st.path || typeof st.path !== "string") errors.push(`step ${i} ("${st.name ?? "?"}"): missing a "path" string`);
  });
  return errors;
}
