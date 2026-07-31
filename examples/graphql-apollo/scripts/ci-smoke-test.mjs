// scripts/ci-smoke-test.mjs
//
// Two checks: (1) `npm run build` already ran -- this script assumes that;
// (2) exercise the actual schema/resolver logic directly via
// createEcoFakerApolloClient(), bypassing React and the browser entirely.
// This is deliberately the same "direct resolver check" documented in
// TUTORIAL.md's Testing section -- fast, and it catches schema/resolver
// regressions (bad filter/sort/pagination logic) without waiting on a
// full browser-based E2E run.

import { generate } from "eco-faker";
import { createEcoFakerApolloClient } from "eco-faker/apollo";
import { gql } from "@apollo/client";

const dataset = generate({ seed: 42, scaleFactor: 300, catalogSize: 250, historicalDays: 90, returnRate: 0.12 });
const client = createEcoFakerApolloClient(dataset);

const PRODUCTS_QUERY = gql`
  query Products($sort: String, $order: String, $page: Int, $pageSize: Int) {
    products(sort: $sort, order: $order, page: $page, pageSize: $pageSize) {
      data
      pagination { page pageSize total totalPages }
    }
  }
`;

const ORDERS_QUERY = gql`
  query Orders($filters: JSON, $sort: String, $order: String, $page: Int, $pageSize: Int) {
    orders(filters: $filters, sort: $sort, order: $order, page: $page, pageSize: $pageSize) {
      data
      pagination { page pageSize total totalPages }
    }
  }
`;

let failed = false;

function check(label, condition) {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failed = true;
  }
}

const p = await client.query({
  query: PRODUCTS_QUERY,
  variables: { sort: "basePrice", order: "desc", page: 1, pageSize: 3 },
});
const products = p.data.products.data;
check("products: returns 3 rows", products.length === 3);
check(
  "products: sorted by basePrice desc",
  products[0].basePrice >= products[1].basePrice && products[1].basePrice >= products[2].basePrice
);
check("products: pagination.total > 0", p.data.products.pagination.total > 0);

const o = await client.query({
  query: ORDERS_QUERY,
  variables: { filters: { status: "delivered" }, sort: "createdAt", order: "desc", page: 1, pageSize: 5 },
});
const orders = o.data.orders.data;
check("orders: filter by status=delivered", orders.every((ord) => ord.status === "delivered"));
check("orders: pagination.total > 0", o.data.orders.pagination.total > 0);

if (failed) {
  console.error("ci-smoke-test: FAILED");
  process.exit(1);
}
console.log("ci-smoke-test: all checks passed");
