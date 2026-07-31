import { useEffect, useState } from "react";
import { fetchOrders, fetchProducts, type Order, type Product } from "./api";
import "./App.css";

function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts({ pageSize: 5 })
      .then((res) => {
        setProducts(res.data);
        setTotal(res.pagination.total);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p data-testid="products-loading">Loading products...</p>;
  if (error) return <p data-testid="products-error">Error: {error}</p>;

  return (
    <section>
      <h2>Products</h2>
      <p data-testid="products-total">{total} products in catalog</p>
      <ul data-testid="products-list">
        {products.map((p) => (
          <li key={p.id}>
            {p.name} — ${p.basePrice.toFixed(2)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrderList() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState("delivered");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchOrders({ status, pageSize: 5 })
      .then((res) => setOrders(res.data))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <section>
      <h2>Orders</h2>
      <label>
        Status:{" "}
        <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="status-select">
          <option value="delivered">Delivered</option>
          <option value="shipped">Shipped</option>
          <option value="processing">Processing</option>
        </select>
      </label>
      {loading ? (
        <p data-testid="orders-loading">Loading orders...</p>
      ) : (
        <ul data-testid="orders-list">
          {orders.map((o) => (
            <li key={o.id}>
              {o.id.slice(0, 8)} — {o.status} — {o.totalFormatted}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function App() {
  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Fake Shopify Backend — MSW + Vitest</h1>
      <ProductList />
      <OrderList />
    </main>
  );
}

export default App;
