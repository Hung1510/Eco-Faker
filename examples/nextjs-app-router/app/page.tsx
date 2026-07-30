import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Fake Shopify Backend — Next.js + eco-faker</h1>
      <p>See TUTORIAL.md for the full walkthrough.</p>
      <ul>
        <li>
          <Link href="/products">Products (Server Component)</Link>
        </li>
        <li>
          <Link href="/orders">Orders (Server Component)</Link>
        </li>
        <li>
          <a href="/api/products">/api/products (Route Handler, JSON)</a>
        </li>
        <li>
          <a href="/api/orders">/api/orders (Route Handler, JSON)</a>
        </li>
      </ul>
    </main>
  );
}
