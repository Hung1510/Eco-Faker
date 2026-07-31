import { useState } from "react";
import { keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query";
import { hooks } from "./lib/queryHooks";
import type { ListResult } from "eco-faker/react-query";
import "./App.css";

interface Product {
  id: string;
  name: string;
  basePrice: number;
}

interface Order {
  id: string;
  status: string;
  totalFormatted: string;
}

function ProductsPanel() {
  const [page, setPage] = useState(1);

  // placeholderData: keepPreviousData -- while page 2 loads, keep showing
  // page 1's data instead of a loading flash. `isFetching` (not `isLoading`)
  // is what tells you a background request is in flight for the page
  // you're currently viewing.
  const { data, isLoading, isFetching } = hooks.products.useList(
    { page, pageSize: 5 },
    { placeholderData: keepPreviousData, staleTime: 30_000 }
  );

  const products = ((data?.data as unknown as Product[]) ?? []);
  const pagination = data?.pagination;

  if (isLoading) return <p data-testid="products-loading">Loading products...</p>;

  return (
    <section>
      <h2>Products {isFetching && <span data-testid="products-fetching">(updating...)</span>}</h2>
      <ul data-testid="products-list">
        {products.map((p) => (
          <li key={p.id}>
            {p.name} — ${p.basePrice.toFixed(2)}
          </li>
        ))}
      </ul>
      {pagination && (
        <p>
          Page {pagination.page} of {pagination.totalPages}{" "}
          <button data-testid="prev-page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </button>{" "}
          <button
            data-testid="next-page"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </p>
      )}
    </section>
  );
}

const ORDERS_PARAMS = { filters: { status: "processing" }, pageSize: 5 };
const ORDERS_QUERY_KEY = ["eco-faker", "orders", "list", ORDERS_PARAMS] as const;

function OrdersPanel() {
  const queryClient = useQueryClient();

  // refetchInterval keeps this list quietly up to date in the background --
  // no manual polling code, no user-triggered refresh button required.
  const { data, dataUpdatedAt } = hooks.orders.useList(ORDERS_PARAMS, { refetchInterval: 4000 });

  const orders = ((data?.data as unknown as Order[]) ?? []);

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to cancel order");
      return res.json();
    },
    onMutate: async (orderId: string) => {
      // Stop any in-flight refetch from clobbering our optimistic write.
      await queryClient.cancelQueries({ queryKey: ORDERS_QUERY_KEY });
      const previous = queryClient.getQueryData<ListResult<Order>>(ORDERS_QUERY_KEY);

      queryClient.setQueryData<ListResult<Order>>(ORDERS_QUERY_KEY, (old) =>
        old
          ? { ...old, data: old.data.map((o) => (o.id === orderId ? { ...o, status: "cancelled" } : o)) }
          : old
      );

      return { previous };
    },
    onError: (_err, _orderId, context) => {
      // Roll back to the pre-mutation snapshot if the request fails.
      if (context?.previous) queryClient.setQueryData(ORDERS_QUERY_KEY, context.previous);
    },
    onSettled: () => {
      // Reconcile with the server's actual state either way.
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
    },
  });

  return (
    <section>
      <h2>Processing orders</h2>
      <p data-testid="orders-updated-at">Last updated: {new Date(dataUpdatedAt).toLocaleTimeString()}</p>
      <ul data-testid="orders-list">
        {orders.map((o) => (
          <li key={o.id} data-testid="order-row">
            {o.id.slice(0, 8)} — <span data-testid="order-status">{o.status}</span> — {o.totalFormatted}{" "}
            <button
              data-testid="cancel-button"
              disabled={o.status === "cancelled"}
              onClick={() => cancelMutation.mutate(o.id)}
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function App() {
  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Fake Shopify Backend — TanStack React Query</h1>
      <ProductsPanel />
      <OrdersPanel />
    </main>
  );
}

export default App;
