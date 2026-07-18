import { http, HttpResponse, type HttpHandler } from "msw";
import type { Dataset } from "./types.js";
import {
  TABLE_ROUTES,
  applyFiltersToRecords,
  applySortToRecords,
  paginateRecords,
  resolveMeaning,
  type DatasetArrayKey,
} from "./serve.js";

export interface MswHandlerOptions {
  /** Prefix every route with this path (default: "/api", matching `serve`'s default mount point). */
  basePath?: string;
}

function queryToRecord(url: URL): Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of url.searchParams.entries()) {
    record[key] = value;
  }
  return record;
}

/**
 * Turn a generated `Dataset` into an array of MSW request handlers -- one
 * `GET <base>/<table>` (paginated, filterable, sortable) and one
 * `GET <base>/<table>/:id` per table, mirroring `serve`'s routes and query
 * semantics exactly (same `applyFiltersToRecords`/`applySortToRecords`/
 * `paginateRecords` helpers, so behavior can't drift between the two
 * adapters). Meant for `setupServer(...toMswHandlers(dataset))` in tests, or
 * `setupWorker(...)` in the browser -- no standalone HTTP server required.
 *
 * Every response also carries the same `X-Eco-Faker-Meaning` header `serve`
 * sends, so anything reading response headers behaves identically whether
 * it's talking to `serve` or to these MSW handlers.
 */
export function toMswHandlers(dataset: Dataset, options: MswHandlerOptions = {}): HttpHandler[] {
  const base = (options.basePath ?? "/api").replace(/\/+$/, "");
  const handlers: HttpHandler[] = [];

  for (const [route, datasetKey] of Object.entries(TABLE_ROUTES) as [string, DatasetArrayKey][]) {
    handlers.push(
      http.get(`*${base}/${route}`, ({ request }) => {
        const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
        const url = new URL(request.url);
        const query = queryToRecord(url);
        const filtered = applySortToRecords(applyFiltersToRecords(rows, query), query);
        const body = paginateRecords(filtered, query);
        const meaning = resolveMeaning(datasetKey, false, 200);
        return HttpResponse.json(body, { headers: { "X-Eco-Faker-Meaning": meaning } });
      })
    );

    handlers.push(
      http.get(`*${base}/${route}/:id`, ({ params }) => {
        const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
        const row = rows.find((r) => r.id === params.id);
        if (!row) {
          const meaning = resolveMeaning(datasetKey, true, 404);
          return HttpResponse.json(
            { error: `No record in ${route} with id ${String(params.id)}` },
            { status: 404, headers: { "X-Eco-Faker-Meaning": meaning } }
          );
        }
        const meaning = resolveMeaning(datasetKey, true, 200);
        return HttpResponse.json(row, { headers: { "X-Eco-Faker-Meaning": meaning } });
      })
    );
  }

  handlers.push(
    http.get(`*${base}`, () => {
      return HttpResponse.json({
        name: "eco-faker mock API (msw)",
        endpoints: Object.keys(TABLE_ROUTES).map((route) => `${base}/${route}`),
        counts: Object.fromEntries(Object.entries(TABLE_ROUTES).map(([route, key]) => [route, dataset[key].length])),
      });
    })
  );

  return handlers;
}
