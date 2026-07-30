// app/products/page.tsx
//
// A Server Component -- runs only on the server, never ships this code or
// the underlying dataset to the browser. It imports the dataset module
// directly rather than fetching /api/products: there's no reason to pay for
// a network round trip to talk to your own process.

import { dataset } from "@/lib/dataset";

export default function ProductsPage() {
  const products = dataset.products.slice(0, 24);

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Products</h1>
      <p>{dataset.products.length} products in the catalog (showing first 24)</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
        {products.map((product) => (
          <div key={product.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
            <strong>{product.name}</strong>
            <div style={{ color: "#666", fontSize: 14 }}>{product.sku}</div>
            <div style={{ marginTop: 8 }}>
              ${product.basePrice.toFixed(2)} {product.currency}
            </div>
            {product.variants.length > 1 && (
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{product.variants.length} variants</div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
