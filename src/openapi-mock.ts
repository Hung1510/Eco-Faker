import { readFileSync } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { authMiddleware, chaosMiddleware, DEFAULT_CHAOS_OPTIONS, type ChaosOptions } from "./serve.js";

/**
 * Minimal shape this module actually reads off an OpenAPI document --
 * deliberately narrow, matching this project's existing convention (see
 * `OpenApiDocument` in contract-test.ts) of each module defining only the
 * fields it needs rather than a full spec type.
 *
 * OpenAPI 3.x only. Swagger 2.0 declares response examples directly under
 * `responses.<code>.examples.<mediatype>` with no `content` wrapper --
 * genuinely different enough from 3.x's `content.<mediatype>.example(s)`
 * that silently half-supporting both felt worse than being explicit: if a
 * 2.0 document is given, its examples (if any) simply won't be found, and
 * every route falls back to the honest "no example declared" response
 * rather than a confusing partial parse.
 */
export interface OpenApiExampleDoc {
  paths?: Record<string, Record<string, OpenApiExampleOperation>>;
}

interface OpenApiExampleOperation {
  responses?: Record<string, OpenApiExampleResponse>;
}

interface OpenApiExampleResponse {
  content?: {
    "application/json"?: {
      example?: unknown;
      examples?: Record<string, { value?: unknown }>;
      schema?: { example?: unknown };
    };
  };
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

export interface ResolvedExampleRoute {
  method: HttpMethod;
  /** Original OpenAPI path template, e.g. `/orders/{id}`. */
  specPath: string;
  /** Express-compatible path, e.g. `/orders/:id`. */
  expressPath: string;
  statusCode: number;
  body: unknown;
}

/**
 * Load an OpenAPI document from a local file (JSON or YAML/YML, by
 * extension) or a live `http(s)://` URL (JSON or YAML by response body --
 * sniffed the same way, since a URL has no file extension to go by).
 * Mirrors `init --schema`'s existing local-vs-URL dispatch
 * (`/^https?:\/\//`) rather than introducing a different convention.
 */
export async function loadOpenApiExampleDoc(pathOrUrl: string): Promise<OpenApiExampleDoc> {
  const isUrl = /^https?:\/\//.test(pathOrUrl);
  let raw: string;
  let looksLikeYaml: boolean;
  if (isUrl) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec from ${pathOrUrl}: HTTP ${response.status} ${response.statusText}`);
    }
    raw = await response.text();
    looksLikeYaml = raw.trimStart().startsWith("{") === false;
  } else {
    raw = readFileSync(pathOrUrl, "utf-8");
    looksLikeYaml = [".yaml", ".yml"].includes(path.extname(pathOrUrl).toLowerCase());
  }
  try {
    return (looksLikeYaml ? loadYaml(raw) : JSON.parse(raw)) as OpenApiExampleDoc;
  } catch (err) {
    throw new Error(`Could not parse OpenAPI spec at ${pathOrUrl} as ${looksLikeYaml ? "YAML" : "JSON"}: ${(err as Error).message}`);
  }
}

/** `/orders/{id}/items/{itemId}` -> `/orders/:id/items/:itemId` -- Express's own path-param syntax, not OpenAPI's. */
export function openApiPathToExpressPath(specPath: string): string {
  return specPath.replace(/\{([^}]+)\}/g, ":$1");
}

/**
 * Pick ONE example out of a response's declared `example`/`examples`/
 * `schema.example` -- in that priority order, matching how real OpenAPI
 * tooling (Swagger UI, Prism) resolves the same three sibling fields when
 * more than one is present. `examples` is a *map* of named examples (a
 * real spec might document `success`/`emptyResult`/`withDiscount` for the
 * same response); this mock is stateless and has no way to know which
 * case a given request wants, so it deterministically takes the
 * alphabetically-first key rather than object insertion order (which
 * would silently depend on how the spec's author happened to write the
 * keys). Returns `undefined` -- not a fabricated value -- when none of
 * the three fields is present.
 */
function resolveExampleValue(response: OpenApiExampleResponse | undefined): unknown {
  const content = response?.content?.["application/json"];
  if (!content) return undefined;
  if ("example" in content && content.example !== undefined) return content.example;
  if (content.examples && Object.keys(content.examples).length > 0) {
    const firstKey = Object.keys(content.examples).sort()[0];
    return content.examples[firstKey]?.value;
  }
  if (content.schema?.example !== undefined) return content.schema.example;
  return undefined;
}

/**
 * Which declared status code to actually serve when a request comes in.
 * This mock has no request state to distinguish "the 200 case" from "the
 * 404 case" the way a real backend would -- it can only serve one
 * response per route. Prefers the numerically-lowest declared 2xx (a
 * spec listing 200 and 201 for the same operation almost always means
 * 200 is the common case), falling back to `default` if that's the only
 * response with an example, and otherwise the lowest declared code of any
 * kind. Stated plainly: this is a single-happy-path mock, not a
 * request-aware state machine -- see README for what that does and
 * doesn't cover.
 */
function pickResponseCode(responses: Record<string, OpenApiExampleResponse> | undefined): string | undefined {
  if (!responses) return undefined;
  const codes = Object.keys(responses).filter((c) => c !== "default");
  const twoXx = codes.filter((c) => /^2\d\d$/.test(c)).sort();
  if (twoXx.length > 0) return twoXx[0];
  if (responses.default) return "default";
  return codes.sort()[0];
}

/**
 * Walk every path/method/response in the document and resolve exactly one
 * example per operation (the one `pickResponseCode`/`resolveExampleValue`
 * settle on). Operations with no usable example anywhere are omitted from
 * the result entirely -- callers use that to serve an honest "not
 * declared" response instead of inventing one.
 */
export function resolveExampleRoutes(doc: OpenApiExampleDoc): ResolvedExampleRoute[] {
  const routes: ResolvedExampleRoute[] = [];
  for (const [specPath, operations] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = operations[method];
      if (!operation) continue;
      const code = pickResponseCode(operation.responses);
      if (!code) continue;
      const body = resolveExampleValue(operation.responses?.[code]);
      if (body === undefined) continue;
      routes.push({
        method,
        specPath,
        expressPath: openApiPathToExpressPath(specPath),
        statusCode: code === "default" ? 200 : parseInt(code, 10),
        body,
      });
    }
  }
  return routes;
}

export interface OpenApiExampleServerOptions {
  chaos?: Partial<ChaosOptions> | true;
  apiKey?: string;
  quiet?: boolean;
}

/**
 * A mock server whose every response is a real, verbatim example taken
 * from an OpenAPI 3.x document -- no dataset generation, no fabricated
 * data. Every declared path+method with a resolvable example gets a real
 * Express route; every path+method declared in the spec but WITHOUT a
 * resolvable example gets a 501 saying so explicitly (never a fabricated
 * 200), and anything not in the spec at all gets a 404. Reuses `serve`'s
 * own auth/chaos middleware directly rather than reimplementing either.
 */
export function createOpenApiExampleServer(doc: OpenApiExampleDoc, options: OpenApiExampleServerOptions = {}): Express {
  const app = express();
  const resolved = resolveExampleRoutes(doc);
  const resolvedKeys = new Set(resolved.map((r) => `${r.method} ${r.expressPath}`));

  // Every path+method declared in the spec at all (even ones with no
  // usable example) -- so a route that's real but example-less gets a
  // specific 501, distinct from a 404 for a route the spec never mentions.
  const declaredButNoExample: { method: HttpMethod; expressPath: string; specPath: string }[] = [];
  for (const [specPath, operations] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (!operations[method]) continue;
      const expressPath = openApiPathToExpressPath(specPath);
      if (!resolvedKeys.has(`${method} ${expressPath}`)) {
        declaredButNoExample.push({ method, expressPath, specPath });
      }
    }
  }

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "eco-faker OpenAPI-examples mock",
      mode: "openapi-examples",
      routesWithExamples: resolved.map((r) => `${r.method.toUpperCase()} ${r.specPath}`),
      routesWithoutExamples: declaredButNoExample.map((r) => `${r.method.toUpperCase()} ${r.specPath}`),
      auth: Boolean(options.apiKey),
      chaos: Boolean(options.chaos),
    });
  });

  if (options.apiKey) app.use(authMiddleware(options.apiKey));
  if (options.chaos) {
    const chaosOptions: ChaosOptions = { ...DEFAULT_CHAOS_OPTIONS, ...(options.chaos === true ? {} : options.chaos) };
    app.use(chaosMiddleware(chaosOptions));
  }

  const logRequest = (method: string, expressPath: string, status: number) => {
    if (options.quiet) return;
    console.log(`${method.toUpperCase().padEnd(6)} ${expressPath}  ${status}`);
  };

  // Real bug, caught by actually running a server and requesting a static
  // sibling of a param route (e.g. `/widgets/no-example` alongside
  // `/widgets/{id}`), not by reading the registration code: Express (like
  // most routers) matches routes in registration order, so a `:id` param
  // route registered first swallows every literal sibling path that would
  // otherwise match a more specific static route registered later.
  // Combining both route lists and sorting by specificity -- fewer `:`
  // param segments first, longer path as a tiebreak -- guarantees static
  // routes always register before param routes for the same method,
  // regardless of which of the two source lists (has-example /
  // no-example) either one came from.
  type PendingRoute = { method: HttpMethod; expressPath: string; specPath: string; handler: (req: Request, res: Response) => void };
  const pending: PendingRoute[] = [];

  for (const route of resolved) {
    pending.push({
      method: route.method,
      expressPath: route.expressPath,
      specPath: route.specPath,
      handler: (_req: Request, res: Response) => {
        logRequest(route.method, route.expressPath, route.statusCode);
        res.status(route.statusCode).json(route.body);
      },
    });
  }
  for (const route of declaredButNoExample) {
    pending.push({
      method: route.method,
      expressPath: route.expressPath,
      specPath: route.specPath,
      handler: (_req: Request, res: Response) => {
        logRequest(route.method, route.expressPath, 501);
        res.status(501).json({
          error: `${route.method.toUpperCase()} ${route.specPath} is declared in the spec, but has no example/examples/schema.example on any response -- nothing to serve. Add one to the spec, or generate a dataset-backed mock instead with plain \`serve\`.`,
        });
      },
    });
  }

  const paramCount = (p: string) => (p.match(/:/g) ?? []).length;
  pending.sort((a, b) => paramCount(a.expressPath) - paramCount(b.expressPath) || b.expressPath.length - a.expressPath.length);

  for (const route of pending) {
    app[route.method](route.expressPath, route.handler);
  }

  app.use((req: Request, res: Response, _next: NextFunction) => {
    res.status(404).json({ error: `${req.method} ${req.path} isn't declared anywhere in this OpenAPI document.` });
  });

  return app;
}
