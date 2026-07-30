// app/orders/page.tsx
import { dataset } from "@/lib/dataset";

export default function OrdersPage() {
  const userById = new Map(dataset.users.map((u) => [u.id, u]));
  const orders = [...dataset.orders]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 25);

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Recent orders</h1>
      <p>{dataset.orders.length} total orders (showing 25 most recent)</p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Order</th>
            <th style={{ padding: 8 }}>Customer</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Total</th>
            <th style={{ padding: 8 }}>Placed</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const customer = userById.get(order.userId);
            return (
              <tr key={order.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>{order.id.slice(0, 8)}</td>
                <td style={{ padding: 8 }}>
                  {customer ? `${customer.firstName} ${customer.lastName}` : "Unknown"}
                </td>
                <td style={{ padding: 8 }}>{order.status}</td>
                <td style={{ padding: 8 }}>{order.totalFormatted}</td>
                <td style={{ padding: 8 }}>{new Date(order.createdAt).toLocaleDateString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
