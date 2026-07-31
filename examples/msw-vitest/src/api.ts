// src/api.ts
//
// Plain fetch() calls -- no special test-awareness, no mock-aware branching.
// MSW intercepts these at the network layer, so this file is identical to
// what it would look like talking to a real backend.

export interface Product {
  id: string;
  name: string;
  basePrice: number;
  currency: string;
}

export interface Order {
  id: string;
  status: string;
  totalFormatted: string;
}

interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export async function fetchProducts(params: { q?: string; page?: number; pageSize?: number } = {}) {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  const res = await fetch(`/api/products?${search.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
  return (await res.json()) as Paginated<Product>;
}

export async function fetchOrders(params: { status?: string; page?: number; pageSize?: number } = {}) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  const res = await fetch(`/api/orders?${search.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch orders: ${res.status}`);
  return (await res.json()) as Paginated<Order>;
}
