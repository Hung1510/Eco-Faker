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
