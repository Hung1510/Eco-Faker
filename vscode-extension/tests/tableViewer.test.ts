import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildTableViewerHtml, loadDatasetTables, type DatasetTables } from "../src/tableViewer.js";

const sampleDataset: DatasetTables = {
  orders: [
    { id: "o1", total: 42.5, status: "delivered" },
    { id: "o2", total: 9.99, status: "processing" },
    { id: "o3", total: 150, status: "delivered" },
  ],
  users: [
    { id: "u1", email: "alice@example.com" },
    { id: "u2", email: "bob@example.com" },
  ],
};

function renderInJsdom(dataset: DatasetTables) {
  const html = buildTableViewerHtml(dataset);
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  return dom;
}

describe("buildTableViewerHtml", () => {
  it("produces valid, parseable HTML with one <option> per table", () => {
    const dom = renderInJsdom(sampleDataset);
    const options = [...dom.window.document.querySelectorAll("#table-select option")];
    assert.deepEqual(
      options.map((o) => o.getAttribute("value")),
      ["orders", "users"]
    );
    assert.ok(options[0].textContent?.includes("(3)")); // real row count in the label
    assert.ok(options[1].textContent?.includes("(2)"));
  });

  it("actually renders the first table's real rows on load, not a placeholder", () => {
    const dom = renderInJsdom(sampleDataset);
    const rows = [...dom.window.document.querySelectorAll("#table-body tr")];
    assert.equal(rows.length, 3);
    assert.ok(dom.window.document.getElementById("table-body")!.textContent!.includes("o1"));
    assert.ok(dom.window.document.getElementById("page-info")!.textContent!.includes("3 rows"));
  });

  it("actually switches tables when the select's change event fires", () => {
    const dom = renderInJsdom(sampleDataset);
    const select = dom.window.document.getElementById("table-select") as HTMLSelectElement;
    select.value = "users";
    select.dispatchEvent(new dom.window.Event("change"));
    const rows = [...dom.window.document.querySelectorAll("#table-body tr")];
    assert.equal(rows.length, 2);
    assert.ok(dom.window.document.getElementById("table-body")!.textContent!.includes("alice@example.com"));
  });

  it("actually filters rows when typing in the search box", () => {
    const dom = renderInJsdom(sampleDataset);
    const search = dom.window.document.getElementById("search-box") as HTMLInputElement;
    search.value = "delivered";
    search.dispatchEvent(new dom.window.Event("input"));
    const rows = [...dom.window.document.querySelectorAll("#table-body tr")];
    assert.equal(rows.length, 2); // o1 and o3 are "delivered", o2 is "processing"
    assert.ok(dom.window.document.getElementById("page-info")!.textContent!.includes('matching "delivered"'));
  });

  it("actually sorts numerically when a numeric column header is clicked, ascending then descending", () => {
    const dom = renderInJsdom(sampleDataset);
    const totalHeader = () =>
      [...dom.window.document.querySelectorAll("#table-head th")].find((th) => th.getAttribute("data-col") === "total")!;

    // Re-query the header before each click: render() replaces #table-head's
    // innerHTML wholesale, so a reference held from before the first click
    // is a detached node by the second click -- dispatching on it wouldn't
    // bubble to the delegated listener at all. A real click always lands on
    // whatever's actually live in the DOM at that moment, so this mirrors
    // real usage; holding a stale reference across a re-render doesn't.
    totalHeader().dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    let firstCellValues = [...dom.window.document.querySelectorAll("#table-body tr")].map((tr) => tr.children[1].textContent);
    assert.deepEqual(firstCellValues, ["9.99", "42.5", "150"]); // ascending

    totalHeader().dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    firstCellValues = [...dom.window.document.querySelectorAll("#table-body tr")].map((tr) => tr.children[1].textContent);
    assert.deepEqual(firstCellValues, ["150", "42.5", "9.99"]); // descending after a second click
  });

  it("actually paginates -- prev/next buttons genuinely change which rows are visible", () => {
    const manyOrders: DatasetTables = {
      orders: Array.from({ length: 30 }, (_, i) => ({ id: `o${i}`, total: i })),
    };
    const dom = renderInJsdom(manyOrders);
    assert.equal([...dom.window.document.querySelectorAll("#table-body tr")].length, 25); // default pageSize
    assert.ok((dom.window.document.getElementById("prev-page") as HTMLButtonElement).disabled);
    assert.equal((dom.window.document.getElementById("next-page") as HTMLButtonElement).disabled, false);

    dom.window.document.getElementById("next-page")!.dispatchEvent(new dom.window.Event("click"));
    const secondPageRows = [...dom.window.document.querySelectorAll("#table-body tr")];
    assert.equal(secondPageRows.length, 5); // remaining 30 - 25
    assert.ok((dom.window.document.getElementById("next-page") as HTMLButtonElement).disabled);

    dom.window.document.getElementById("prev-page")!.dispatchEvent(new dom.window.Event("click"));
    assert.equal([...dom.window.document.querySelectorAll("#table-body tr")].length, 25);
  });

  it("escapes HTML in cell values so a malicious/unusual string can't break out of the table markup", () => {
    const dangerousDataset: DatasetTables = { orders: [{ id: "o1", note: "<script>alert(1)</script>" }] };
    const dom = renderInJsdom(dangerousDataset);
    assert.equal(dom.window.document.querySelectorAll("#table-body script").length, 0);
    assert.ok(dom.window.document.getElementById("table-body")!.innerHTML.includes("&lt;script&gt;"));
  });

  it("handles an empty table without throwing", () => {
    const dom = renderInJsdom({ orders: [] });
    assert.equal([...dom.window.document.querySelectorAll("#table-body tr")].length, 0);
    assert.ok(dom.window.document.getElementById("page-info")!.textContent!.includes("0 rows"));
  });
});

describe("loadDatasetTables", () => {
  it("parses real JSON and keeps only array-valued top-level keys", () => {
    const raw = JSON.stringify({ orders: [{ id: "o1" }], users: [{ id: "u1" }], notATable: "some string" });
    const tables = loadDatasetTables(raw);
    assert.deepEqual(Object.keys(tables).sort(), ["orders", "users"]);
  });

  it("naturally excludes config even if somehow present, since config is never an array", () => {
    const raw = JSON.stringify({ config: { seed: 1 }, orders: [{ id: "o1" }] });
    const tables = loadDatasetTables(raw);
    assert.deepEqual(Object.keys(tables), ["orders"]);
  });
});

const relationshipDataset: DatasetTables = {
  users: [
    { id: "u1", firstName: "Alice", lastName: "Nguyen", email: "alice@example.com" },
    { id: "u2", firstName: "Bob", lastName: "Tran", email: "bob@example.com" },
  ],
  orders: [
    { id: "o1", userId: "u1", status: "delivered", total: 42.5, currency: "USD", createdAt: "2026-01-05T00:00:00Z", items: [{ sku: "a" }] },
    { id: "o2", userId: "u1", status: "processing", total: 9.99, currency: "USD", createdAt: "2026-01-06T00:00:00Z", items: [] },
    // u2 deliberately has no orders, to exercise the "this user has no orders" empty state.
  ],
  shipments: [
    {
      id: "s1",
      orderId: "o1",
      carrier: "UPS",
      trackingNumber: "1Z999",
      status: "delivered",
      delayed: false,
      packageIndex: 0,
      totalPackages: 1,
      events: [{ status: "delivered", timestamp: "2026-01-08T10:00:00Z", location: "Front door" }],
    },
  ],
  returnRequests: [
    { id: "r1", orderId: "o1", reason: "wrong size", status: "approved", requestedAt: "2026-01-09T00:00:00Z", refundAmountFormatted: "$42.50", resolvedAt: null },
  ],
};

function renderRelationshipsInJsdom(dataset: DatasetTables) {
  const html = buildTableViewerHtml(dataset);
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  // Switch to the Relationships tab -- it starts hidden, same as a real user would click to it.
  dom.window.document.getElementById("eco-tab-btn-relationships")!.dispatchEvent(new dom.window.Event("click"));
  return dom;
}

describe("buildTableViewerHtml -- relationship drill-down (User → Orders → Shipment/Returns)", () => {
  it("offers an enabled Relationships tab when the dataset has the real shape it needs (non-empty users/orders/shipments)", () => {
    const dom = renderInJsdom(relationshipDataset);
    const tab = dom.window.document.getElementById("eco-tab-btn-relationships") as HTMLButtonElement;
    assert.equal(tab.disabled, false);
  });

  it("disables the Relationships tab, with a clear reason, when the dataset is missing a needed table", () => {
    const dom = renderInJsdom({ orders: [{ id: "o1" }] }); // no users, no shipments
    const tab = dom.window.document.getElementById("eco-tab-btn-relationships") as HTMLButtonElement;
    assert.equal(tab.disabled, true);
    assert.ok(tab.title.length > 0, "expected a title/tooltip explaining why it's disabled");
  });

  it("renders every real user on load, with their real order count, not a placeholder", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    const usersCol = dom.window.document.getElementById("rel-col-users")!;
    assert.ok(usersCol.textContent!.includes("Alice"));
    assert.ok(usersCol.textContent!.includes("Bob"));
    assert.ok(usersCol.textContent!.includes("2 orders")); // Alice has 2 real orders
    assert.ok(usersCol.textContent!.includes("0 orders")); // Bob has none
  });

  it("clicking a user drills down into their real orders", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    const aliceRow = dom.window.document.querySelector('[data-user-id="u1"]') as HTMLElement;
    aliceRow.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    const ordersCol = dom.window.document.getElementById("rel-col-orders")!;
    assert.ok(ordersCol.textContent!.includes("o1".slice(0, 8)) || ordersCol.querySelectorAll("[data-order-id]").length === 2);
    assert.equal(ordersCol.querySelectorAll("[data-order-id]").length, 2);
  });

  it("clicking a user with no orders shows a real empty state, not stale data from a previous selection", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    dom.window.document.querySelector('[data-user-id="u1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    assert.equal(dom.window.document.getElementById("rel-col-orders")!.querySelectorAll("[data-order-id]").length, 2);

    dom.window.document.querySelector('[data-user-id="u2"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    const ordersCol = dom.window.document.getElementById("rel-col-orders")!;
    assert.equal(ordersCol.querySelectorAll("[data-order-id]").length, 0);
    assert.ok(ordersCol.textContent!.includes("no orders"));
  });

  it("clicking an order drills down into its real shipment AND return request simultaneously", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    dom.window.document.querySelector('[data-user-id="u1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    dom.window.document.querySelector('[data-order-id="o1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

    const shipmentsCol = dom.window.document.getElementById("rel-col-shipments")!;
    const returnsCol = dom.window.document.getElementById("rel-col-returns")!;
    assert.equal(shipmentsCol.querySelectorAll("[data-shipment-id]").length, 1);
    assert.ok(shipmentsCol.textContent!.includes("UPS"));
    assert.equal(returnsCol.querySelectorAll("[data-return-id]").length, 1);
    assert.ok(returnsCol.textContent!.includes("wrong size"));
  });

  it("an order with no shipment/return shows real empty states for both columns", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    dom.window.document.querySelector('[data-user-id="u1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    dom.window.document.querySelector('[data-order-id="o2"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true })); // o2 has no shipment/return

    const shipmentsCol = dom.window.document.getElementById("rel-col-shipments")!;
    const returnsCol = dom.window.document.getElementById("rel-col-returns")!;
    assert.ok(shipmentsCol.textContent!.includes("No shipments"));
    assert.ok(returnsCol.textContent!.includes("No return request"));
  });

  it("clicking a shipment renders its real tracking timeline in the detail panel", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    dom.window.document.querySelector('[data-user-id="u1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    dom.window.document.querySelector('[data-order-id="o1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    dom.window.document.querySelector('[data-shipment-id="s1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

    const detail = dom.window.document.getElementById("rel-detail")!;
    assert.ok(detail.textContent!.includes("UPS"));
    assert.ok(detail.textContent!.includes("1Z999"));
    assert.ok(detail.textContent!.includes("Front door")); // real tracking event location
  });

  it("clicking a return request renders its real refund/reason detail", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    dom.window.document.querySelector('[data-user-id="u1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    dom.window.document.querySelector('[data-order-id="o1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    dom.window.document.querySelector('[data-return-id="r1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

    const detail = dom.window.document.getElementById("rel-detail")!;
    assert.ok(detail.textContent!.includes("wrong size"));
    assert.ok(detail.textContent!.includes("$42.50"));
    assert.ok(detail.textContent!.includes("not yet")); // resolvedAt is null in the fixture
  });

  it("the breadcrumb reflects the real current drill-down path", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    assert.ok(dom.window.document.getElementById("rel-breadcrumb")!.textContent!.includes("Pick a user"));

    dom.window.document.querySelector('[data-user-id="u1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    assert.ok(dom.window.document.getElementById("rel-breadcrumb")!.textContent!.includes("Alice Nguyen"));

    dom.window.document.querySelector('[data-order-id="o1"]')!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    assert.ok(dom.window.document.getElementById("rel-breadcrumb")!.textContent!.includes("Order #"));
  });

  it("the user search filter actually filters by name and email, not just visually hiding rows", () => {
    const dom = renderRelationshipsInJsdom(relationshipDataset);
    const search = dom.window.document.getElementById("rel-search") as HTMLInputElement;
    search.value = "bob";
    search.dispatchEvent(new dom.window.Event("input"));
    const usersCol = dom.window.document.getElementById("rel-col-users")!;
    assert.equal(usersCol.querySelectorAll("[data-user-id]").length, 1);
    assert.ok(usersCol.textContent!.includes("Bob"));
    assert.equal(usersCol.textContent!.includes("Alice"), false);
  });

  it("escapes HTML in relationship fields the same way the flat table view does", () => {
    const dangerous: DatasetTables = {
      users: [{ id: "u1", firstName: "<script>alert(1)</script>", lastName: "X", email: "x@example.com" }],
      orders: [{ id: "o1", userId: "u1", status: "delivered", total: 1, currency: "USD", createdAt: "2026-01-01T00:00:00Z", items: [] }],
      shipments: [{ id: "s1", orderId: "o1", carrier: "UPS", trackingNumber: "1", status: "delivered", delayed: false, packageIndex: 0, totalPackages: 1, events: [] }],
    };
    const dom = renderRelationshipsInJsdom(dangerous);
    assert.equal(dom.window.document.querySelectorAll("#rel-col-users script").length, 0);
    assert.ok(dom.window.document.getElementById("rel-col-users")!.innerHTML.includes("&lt;script&gt;"));
  });
});
