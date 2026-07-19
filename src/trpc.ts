import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Dataset } from "./types.js";
import {
  TABLE_ROUTES,
  applyFiltersToRecords,
  applySortToRecords,
  paginateRecords,
  resolveMeaning,
  type DatasetArrayKey,
} from "./serve.js";

const t = initTRPC.create();

const listInputSchema = z.object({
  filters: z.record(z.string()).optional().describe("Exact-match filters, e.g. { status: 'delivered' }"),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
});

const byIdInputSchema = z.object({ id: z.string() });

/**
 * `EcoFakerRouterOutput`'s per-table shape: a `list` query (filter/sort/
 * paginate, same semantics as `serve` and the MSW adapter) and a `byId`
 * query, each carrying the same `meaning` field `serve` sends as the
 * `X-Eco-Faker-Meaning` header -- tRPC has no response-header concept in
 * the same sense, so it rides along in the payload instead.
 */
function buildTableRouter(dataset: Dataset, datasetKey: DatasetArrayKey) {
  return t.router({
    list: t.procedure.input(listInputSchema.optional()).query(({ input }) => {
      const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
      const query: Record<string, string | undefined> = {
        ...(input?.filters ?? {}),
        sort: input?.sort,
        order: input?.order,
        page: input?.page !== undefined ? String(input.page) : undefined,
        pageSize: input?.pageSize !== undefined ? String(input.pageSize) : undefined,
      };
      const filtered = applySortToRecords(applyFiltersToRecords(rows, query), query);
      const page = paginateRecords(filtered, query);
      return { ...page, meaning: resolveMeaning(datasetKey, false, 200) };
    }),

    byId: t.procedure.input(byIdInputSchema).query(({ input }) => {
      const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
      const row = rows.find((r) => r.id === input.id);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No record in ${String(datasetKey)} with id ${input.id}`,
        });
      }
      return { data: row, meaning: resolveMeaning(datasetKey, true, 200) };
    }),
  });
}

/**
 * Turn a generated `Dataset` into a tRPC router -- one sub-router per table
 * (`router.orders.list`, `router.orders.byId`, etc.), reusing the exact
 * same `applyFiltersToRecords`/`applySortToRecords`/`paginateRecords`
 * helpers as `serve` and the MSW adapter, so query behavior can't drift
 * between any of the three. Meant to be merged into an existing app
 * router (`t.mergeRouters` or spread into your own router's shape) or
 * used standalone for a quick mock backend in a T3-stack-style app.
 */
export function toTrpcRouter(dataset: Dataset) {
  const tableRouters = Object.fromEntries(
    (Object.entries(TABLE_ROUTES) as [string, DatasetArrayKey][]).map(([route, datasetKey]) => [
      // tRPC router keys can't contain hyphens as plain property access
      // (e.g. `router["abandoned-checkouts"]` works, `router.abandoned-checkouts`
      // doesn't) -- camelCase the route name instead so `router.abandonedCheckouts.list`
      // reads naturally from consuming code.
      toCamelCase(route),
      buildTableRouter(dataset, datasetKey),
    ])
  );

  return t.router({
    ...tableRouters,
    info: t.procedure.query(() => ({
      name: "eco-faker mock API (tRPC)",
      tables: Object.keys(TABLE_ROUTES).map(toCamelCase),
      counts: Object.fromEntries(
        (Object.entries(TABLE_ROUTES) as [string, DatasetArrayKey][]).map(([route, key]) => [
          toCamelCase(route),
          dataset[key].length,
        ])
      ),
    })),
  });
}

function toCamelCase(routeName: string): string {
  return routeName.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

export type EcoFakerTrpcRouter = ReturnType<typeof toTrpcRouter>;
