import { Ajv, type ErrorObject } from "ajv";
import addFormatsPlugin from "ajv-formats";

// ajv-formats' CJS output (`module.exports = exports.default = formatsPlugin`)
// resolves to a non-callable type under this project's NodeNext module
// resolution, even though it's genuinely callable at runtime -- verified
// directly: `require("ajv-formats")` is a function, and its own `.default`
// points back to itself. Casting rather than fighting the type resolution.
const addFormats = addFormatsPlugin as unknown as (ajv: Ajv) => Ajv;

/** Minimal shape this module actually reads off an OpenAPI 3.0 document -- deliberately not the full OpenAPI type, since every other field is irrelevant to contract testing. */
export interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, object> };
}

interface OpenApiOperation {
  parameters?: { name: string; in: string; required?: boolean }[];
  responses?: Record<string, { content?: { "application/json"?: { schema?: object } } }>;
  /** Only read by mutation-test.ts's write-path checks -- the read-path engine below never looks at this. */
  requestBody?: { content?: { "application/json"?: { schema?: object } } };
}

export interface ContractCheckResult {
  method: string;
  /** The templated path from the contract, e.g. `/api/orders/{id}`. */
  path: string;
  /** The actual URL requested, with path params substituted -- empty if the request never happened (e.g. no sample id available). */
  requestUrl: string;
  ok: boolean;
  statusCodesDeclared: string[];
  statusActual?: number;
  /** ajv errors against the declared response schema, if the status matched but the body didn't. */
  schemaErrors?: string[];
  /** Set when the request couldn't be attempted or completed at all (network error, missing sample id, ...) -- distinct from a failed assertion. */
  error?: string;
}

export interface ContractTestOptions {
  baseUrl: string;
  contract: OpenApiDocument;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface ContractTestSummary {
  results: ContractCheckResult[];
  passed: number;
  failed: number;
}

function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`);
}

/**
 * Fires GET requests at `baseUrl` for every read operation declared in
 * `contract` (an OpenAPI 3.0 document -- the exact format `serve`'s own
 * `/openapi.json` produces, so the natural workflow is: point `serve` at
 * one implementation to capture the contract, then test a *different*
 * implementation -- your own real backend -- against it) and asserts both
 * the HTTP status and the response body against the contract's declared
 * schema for that status, resolving `$ref`s against `components.schemas`.
 *
 * Scope, stated plainly: this is the read-path slice of contract testing
 * -- GET list/byId operations only, since that's what an OpenAPI document
 * generated from `serve` (itself read-only) ever declares. It does not
 * fire mutations, replay stateful multi-step scenarios, or check
 * cross-request state consistency beyond the one check that comes for
 * free: a byId path's sample id is sourced from a real list response, so
 * a server returning 404 for an id it just listed is caught automatically.
 * Full stateful-scenario replay against mutating endpoints is out of
 * scope for this pass -- see ROADMAP.md.
 *
 * List (non-parameterized) paths run before `{id}` paths specifically so
 * a real id can be harvested from each list response's first record and
 * reused for that resource's byId check -- there's no dataset dependency
 * here at all, sample ids come from the live API's own responses.
 */
export async function runContractTest(options: ContractTestOptions): Promise<ContractTestSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const schemas = options.contract.components?.schemas ?? {};

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema, `#/components/schemas/${name}`);
  }

  const entries = Object.entries(options.contract.paths ?? {});
  // List paths (no `{...}`) before byId paths, so sample ids are harvested first.
  entries.sort((a, b) => Number(a[0].includes("{")) - Number(b[0].includes("{")));

  const sampleIds = new Map<string, string>(); // list path template -> a real id from its response

  const results: ContractCheckResult[] = [];

  for (const [pathTemplate, operations] of entries) {
    const operation = operations.get;
    if (!operation) continue; // MVP scope: GET only, see doc comment above

    const responses = operation.responses ?? {};
    const successEntry = Object.entries(responses).find(([code]) => code.startsWith("2"));
    if (!successEntry) continue; // nothing declared to assert a shape against

    let requestPath = pathTemplate;
    const idParamMatch = pathTemplate.match(/^(.*)\/\{[^}]+\}$/);
    if (idParamMatch) {
      const listPathTemplate = idParamMatch[1];
      const sampleId = sampleIds.get(listPathTemplate);
      if (!sampleId) {
        results.push({
          method: "GET",
          path: pathTemplate,
          requestUrl: "",
          ok: false,
          statusCodesDeclared: Object.keys(responses),
          error: `no sample id available for ${listPathTemplate} -- its list response returned no records, or that path isn't declared in this contract`,
        });
        continue;
      }
      requestPath = pathTemplate.replace(/\{[^}]+\}$/, sampleId);
    }

    const requestUrl = `${baseUrl}${requestPath}`;
    let res: Response;
    try {
      res = await fetchImpl(requestUrl, { headers: options.headers });
    } catch (err) {
      results.push({
        method: "GET",
        path: pathTemplate,
        requestUrl,
        ok: false,
        statusCodesDeclared: Object.keys(responses),
        error: `request failed: ${(err as Error).message}`,
      });
      continue;
    }

    const statusDeclared = String(res.status) in responses;
    const responseSchema = responses[String(res.status)]?.content?.["application/json"]?.schema;

    let body: unknown;
    let bodyParseError: string | undefined;
    if (responseSchema) {
      try {
        body = await res.json();
      } catch (err) {
        bodyParseError = `response wasn't valid JSON (${(err as Error).message})`;
      }
    }

    let schemaErrors: string[] | undefined;
    if (responseSchema && bodyParseError === undefined) {
      const validate = ajv.compile(responseSchema);
      if (!validate(body)) schemaErrors = formatAjvErrors(validate.errors ?? []);
    }

    if (!idParamMatch && body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
      const list = (body as { data?: unknown }).data;
      const firstId = Array.isArray(list) && list.length > 0 ? (list[0] as { id?: unknown }).id : undefined;
      if (typeof firstId === "string") sampleIds.set(pathTemplate, firstId);
    }

    results.push({
      method: "GET",
      path: pathTemplate,
      requestUrl,
      ok: statusDeclared && !schemaErrors && !bodyParseError,
      statusCodesDeclared: Object.keys(responses),
      statusActual: res.status,
      schemaErrors,
      error: bodyParseError,
    });
  }

  return { results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
