import { useState } from "react";
import { gql } from "@apollo/client";
import { ApolloProvider, useQuery } from "@apollo/client/react";
import { client } from "./lib/apolloClient";
import "./App.css";

const PRODUCTS_QUERY = gql`
  query Products($filters: JSON, $sort: String, $order: String, $page: Int, $pageSize: Int) {
    products(filters: $filters, sort: $sort, order: $order, page: $page, pageSize: $pageSize) {
      data
      pagination {
        page
        pageSize
        total
        totalPages
      }
    }
  }
`;

const ORDERS_QUERY = gql`
  query Orders($filters: JSON, $sort: String, $order: String, $page: Int, $pageSize: Int) {
    orders(filters: $filters, sort: $sort, order: $order, page: $page, pageSize: $pageSize) {
      data
      pagination {
        page
        pageSize
        total
        totalPages
      }
    }
  }
`;

type Product = {
  id: string;
  name: string;
  basePrice: number;
  currency: string;
};

type Order = {
  id: string;
  status: string;
  totalFormatted: string;
  createdAt: string;
};

function ProductsPanel() {
  const [sortField, setSortField] = useState("name");
  const [order, setOrder] = useState("asc");
  const [page, setPage] = useState(1);

  const { data, loading, error } = useQuery<{
    products: { data: Product[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
  }>(PRODUCTS_QUERY, {
    variables: { sort: sortField, order, page, pageSize: 5 },
  });

  if (error) return <p>Error: {error.message}</p>;

  const products: Product[] = data?.products?.data ?? [];
  const pagination = data?.products?.pagination;

  return (
    <section>
      <h2>Products</h2>
      <label>
        Sort by:{" "}
        <select value={sortField} onChange={(e) => setSortField(e.target.value)}>
          <option value="name">Name</option>
          <option value="basePrice">Price</option>
        </select>
      </label>{" "}
      <label>
        Order:{" "}
        <select value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul>
          {products.map((p) => (
            <li key={p.id}>
              {p.name} — ${p.basePrice.toFixed(2)} {p.currency}
            </li>
          ))}
        </ul>
      )}
      {pagination && (
        <p>
          Page {pagination.page} of {pagination.totalPages} ({pagination.total} total){" "}
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </button>{" "}
          <button disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </p>
      )}
    </section>
  );
}

function OrdersPanel() {
  const [status, setStatus] = useState("delivered");

  const { data, loading, error } = useQuery<{
    orders: { data: Order[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
  }>(ORDERS_QUERY, {
    variables: { filters: { status }, sort: "createdAt", order: "desc", page: 1, pageSize: 5 },
  });

  if (error) return <p>Error: {error.message}</p>;

  const orders: Order[] = data?.orders?.data ?? [];
  const pagination = data?.orders?.pagination;

  return (
    <section>
      <h2>Orders</h2>
      <label>
        Filter by status:{" "}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="delivered">Delivered</option>
          <option value="shipped">Shipped</option>
          <option value="processing">Processing</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul>
          {orders.map((o) => (
            <li key={o.id}>
              {o.id.slice(0, 8)} — {o.status} — {o.totalFormatted}
            </li>
          ))}
        </ul>
      )}
      {pagination && (
        <p>
          {pagination.total} orders match "{status}"
        </p>
      )}
    </section>
  );
}

function App() {
  return (
    <ApolloProvider client={client}>
      <main style={{ padding: 32, fontFamily: "sans-serif" }}>
        <h1>Fake Shopify Backend — GraphQL + Apollo Client</h1>
        <p>
          Data source: {import.meta.env.VITE_USE_REAL_API === "true" ? "real GraphQL API" : "eco-faker (in-memory)"}
        </p>
        <ProductsPanel />
        <OrdersPanel />
      </main>
    </ApolloProvider>
  );
}

export default App;
