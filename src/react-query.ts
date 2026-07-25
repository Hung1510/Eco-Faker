import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { TABLE_ROUTES } from "./serve.js";

export interface ListParams {
  /** Exact-match filters, e.g. { status: "delivered" } -- same semantics as `serve`'s query params. */
  filters?: Record<string, string>;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface ListResult<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface EcoFakerQueryHooksOptions {
  /** Where a running `my-eco-gen serve` (or MSW-mocked equivalent) is mounted, e.g. "http://localhost:4000/api". */
  baseUrl: string;
  /** Override fetch -- useful for SSR, auth headers, or pointing at MSW's intercepted global fetch in tests (default: global fetch). */
  fetchImpl?: typeof fetch;
}

type PartialQueryOptions<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn">;

export interface TableQueryHooks<T = Record<string, unknown>> {
  /** Paginated/filtered/sorted list, mirroring `GET <base>/<table>` on `serve` exactly. */
  useList(params?: ListParams, queryOptions?: PartialQueryOptions<ListResult<T>>): UseQueryResult<ListResult<T>, Error>;
  /** Single record by id (the raw row, same body `serve` sends), mirroring `GET <base>/<table>/:id`. Disabled automatically while `id` is undefined. */
  useById(id: string | undefined, queryOptions?: PartialQueryOptions<T>): UseQueryResult<T, Error>;
}

export type EcoFakerQueryHooks = Record<string, TableQueryHooks>;

function buildQueryString(params: ListParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params.filters ?? {})) search.set(key, value);
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`eco-faker query hook: ${res.status} ${res.statusText} fetching ${url}${body ? ` -- ${body}` : ""}`);
  }
  return (await res.json()) as T;
}

function buildTableHooks<T>(route: string, base: string, fetchImpl: typeof fetch): TableQueryHooks<T> {
  return {
    useList(params, queryOptions) {
      return useQuery({
        queryKey: ["eco-faker", route, "list", params ?? {}] as const,
        queryFn: () => fetchJson<ListResult<T>>(`${base}/${route}${buildQueryString(params)}`, fetchImpl),
        ...queryOptions,
      });
    },
    useById(id, queryOptions) {
      return useQuery({
        queryKey: ["eco-faker", route, "byId", id] as const,
        queryFn: () => fetchJson<T>(`${base}/${route}/${id}`, fetchImpl),
        enabled: id !== undefined && (queryOptions?.enabled ?? true),
        ...queryOptions,
      });
    },
  };
}

function toCamelCase(routeName: string): string {
  return routeName.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Turn a running `my-eco-gen serve` endpoint (or `toMswHandlers` intercepting
 * the same routes in tests) into a set of TanStack Query hooks -- one
 * `{ useList, useById }` pair per table, camelCased the same way the tRPC
 * adapter camelCases its router keys (`hooks.abandonedCheckouts`, not
 * `hooks["abandoned-checkouts"]`). Every table in `TABLE_ROUTES` is covered
 * automatically, so a table added to `serve` in the future shows up here
 * with zero new wiring, the same "generic by construction" property the
 * MSW and tRPC adapters already have.
 *
 * Query keys are `["eco-faker", route, "list" | "byId", ...]`, stable
 * across renders as long as `params`/`id` are, so normal React Query
 * caching/invalidation/refetch behavior applies unchanged.
 *
 * @example
 * const hooks = createEcoFakerQueryHooks({ baseUrl: "http://localhost:4000/api" });
 * function OrdersTable() {
 *   const { data, isLoading } = hooks.orders.useList({ filters: { status: "delivered" }, pageSize: 20 });
 *   const { data: order } = hooks.orders.useById(selectedId); // order is the raw record, same as serve's body
 *   // ...
 * }
 */
export function createEcoFakerQueryHooks(options: EcoFakerQueryHooksOptions): EcoFakerQueryHooks {
  const base = options.baseUrl.replace(/\/+$/, "");
  // Wrapped in a closure rather than assigned directly so that, absent an
  // explicit `fetchImpl`, the global `fetch` is looked up fresh on every
  // call -- not captured once at factory-creation time, which would freeze
  // in whatever `fetch` was bound to before test tooling like MSW (or an
  // app's own fetch polyfill) gets a chance to patch the global.
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args));

  const hooks: EcoFakerQueryHooks = {};
  for (const route of Object.keys(TABLE_ROUTES)) {
    hooks[toCamelCase(route)] = buildTableHooks(route, base, fetchImpl);
  }
  return hooks;
}
