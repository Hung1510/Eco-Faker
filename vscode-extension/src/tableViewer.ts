export interface DatasetTables {
  [tableName: string]: unknown[];
}

/**
 * The entire client-side behavior lives in this one template string --
 * embedded into the generated HTML exactly once, and that exact same
 * embedded copy is what gets loaded and actually executed in
 * tests/tableViewer.test.ts via jsdom. There's deliberately no second,
 * "for testing purposes" copy of this logic anywhere: writing one as a
 * real TS function and a near-identical one as an embedded JS string
 * would be exactly the kind of drift this project has hit and fixed
 * before (a hand-maintained list, a hand-typed URL) -- here there's
 * only one copy, and it's verified by actually running it, not by
 * reading it and assuming it's equivalent to some other version.
 */
const CLIENT_SCRIPT = `
(function () {
  const state = { table: null, page: 1, pageSize: 25, search: "", sortColumn: null, sortDirection: "asc" };

  function columnsFor(tableName) {
    const rows = DATASET[tableName];
    if (!rows || rows.length === 0) return [];
    return Object.keys(rows[0]);
  }

  function stringifyCell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function matchesSearch(row, search) {
    if (!search) return true;
    const needle = search.toLowerCase();
    return Object.values(row).some((v) => stringifyCell(v).toLowerCase().includes(needle));
  }

  function compareValues(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  }

  function visibleRows() {
    const rows = DATASET[state.table] || [];
    let filtered = rows.filter((r) => matchesSearch(r, state.search));
    if (state.sortColumn) {
      filtered = filtered.slice().sort((a, b) => {
        const cmp = compareValues(a[state.sortColumn], b[state.sortColumn]);
        return state.sortDirection === "asc" ? cmp : -cmp;
      });
    }
    const totalRows = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * state.pageSize;
    return { rows: filtered.slice(start, start + state.pageSize), totalRows, totalPages };
  }

  function render() {
    const columns = columnsFor(state.table);
    const { rows, totalRows, totalPages } = visibleRows();

    const thead =
      "<tr>" +
      columns
        .map((c) => {
          const arrow = state.sortColumn === c ? (state.sortDirection === "asc" ? " \\u25B2" : " \\u25BC") : "";
          return '<th data-col="' + c + '">' + c + arrow + "</th>";
        })
        .join("") +
      "</tr>";

    const tbody = rows
      .map((row) => "<tr>" + columns.map((c) => "<td>" + escapeHtml(stringifyCell(row[c])) + "</td>").join("") + "</tr>")
      .join("");

    document.getElementById("table-head").innerHTML = thead;
    document.getElementById("table-body").innerHTML = tbody;
    document.getElementById("page-info").textContent = "Page " + state.page + " of " + totalPages + " (" + totalRows + " row" + (totalRows === 1 ? "" : "s") + (state.search ? " matching \\"" + state.search + "\\"" : "") + ")";
    document.getElementById("prev-page").disabled = state.page <= 1;
    document.getElementById("next-page").disabled = state.page >= totalPages;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function selectTable(name) {
    state.table = name;
    state.page = 1;
    state.sortColumn = null;
    render();
  }

  document.getElementById("table-select").addEventListener("change", (e) => selectTable(e.target.value));
  document.getElementById("search-box").addEventListener("input", (e) => {
    state.search = e.target.value;
    state.page = 1;
    render();
  });
  document.getElementById("prev-page").addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    render();
  });
  document.getElementById("next-page").addEventListener("click", () => {
    state.page = state.page + 1;
    render();
  });
  document.getElementById("table-head").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    const col = th.getAttribute("data-col");
    if (state.sortColumn === col) {
      state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    } else {
      state.sortColumn = col;
      state.sortDirection = "asc";
    }
    render();
  });

  window.__ecoFakerTableViewer = { selectTable, render, state };

  const firstTable = Object.keys(DATASET)[0];
  if (firstTable) selectTable(firstTable);
})();
`;

/**
 * A second view mode in the same webview, alongside the flat table
 * browser above -- a direct, faithful port of `web-static/explorer.ts`'s
 * proven Miller-columns drill-down (User → Orders → Shipment/Returns),
 * not a new design. Differs from that browser demo in exactly one way:
 * it has no "regenerate" button, since this webview shows a real,
 * already-generated `dataset.json` the person picked, not a live,
 * re-rollable `generate()` call -- everything else (search, drill-down,
 * breadcrumb, detail panel) is the same real behavior.
 *
 * Only meaningful for datasets that actually have the specific shape this
 * drill-down assumes (`users`/`orders`/`shipments`, `returnRequests`
 * optional) -- `hasRelationshipShape` below decides whether the
 * "Relationships" tab is offered at all, rather than showing a tab that
 * would just render empty columns for an unrelated dataset shape.
 */
const CLIENT_SCRIPT_RELATIONSHIPS = `
(function () {
  if (!window.__ecoFakerHasRelationshipShape) return;

  const USER_LIST_CAP = 300;
  const colUsers = document.getElementById("rel-col-users");
  const colOrders = document.getElementById("rel-col-orders");
  const colShipments = document.getElementById("rel-col-shipments");
  const colReturns = document.getElementById("rel-col-returns");
  const breadcrumbEl = document.getElementById("rel-breadcrumb");
  const detailEl = document.getElementById("rel-detail");
  const searchEl = document.getElementById("rel-search");

  const users = DATASET.users || [];
  const orders = DATASET.orders || [];
  const shipments = DATASET.shipments || [];
  const returnRequests = DATASET.returnRequests || [];

  const ordersByUser = new Map();
  for (const o of orders) {
    const list = ordersByUser.get(o.userId) || [];
    list.push(o);
    ordersByUser.set(o.userId, list);
  }
  const shipmentsByOrder = new Map();
  for (const s of shipments) {
    const list = shipmentsByOrder.get(s.orderId) || [];
    list.push(s);
    shipmentsByOrder.set(s.orderId, list);
  }
  const returnsByOrder = new Map();
  for (const r of returnRequests) {
    const list = returnsByOrder.get(r.orderId) || [];
    list.push(r);
    returnsByOrder.set(r.orderId, list);
  }

  let selectedUser = null;
  let selectedOrder = null;
  let selectedShipment = null;
  let selectedReturn = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function shortId(id) {
    return String(id).slice(0, 8);
  }
  function money(n, currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
    } catch (e) {
      return String(n);
    }
  }
  function statusBadge(status) {
    const s = String(status);
    const cls = s === "delivered" || s === "resolved" ? "ok" : s === "cancelled" || s === "rejected" ? "bad" : "warn";
    return '<span class="rel-badge ' + cls + '">' + escapeHtml(s) + "</span>";
  }

  function resetDownstream(from) {
    if (from === "user") {
      selectedOrder = null;
      colOrders.innerHTML = '<div class="rel-empty">Select a user to see their orders.</div>';
    }
    selectedShipment = null;
    selectedReturn = null;
    colShipments.innerHTML = '<div class="rel-empty">Select an order to see its shipment(s).</div>';
    colReturns.innerHTML = '<div class="rel-empty">Select an order to see any return request.</div>';
    detailEl.innerHTML = '<div class="rel-placeholder">Select a shipment or return request for full tracking / return details.</div>';
  }

  function renderUsers(filterText) {
    const filtered = filterText
      ? users.filter((u) => (u.firstName + " " + u.lastName + " " + u.email).toLowerCase().includes(filterText.toLowerCase()))
      : users;
    const shown = filtered.slice(0, USER_LIST_CAP);

    if (shown.length === 0) {
      colUsers.innerHTML = '<div class="rel-empty">No users match that filter.</div>';
      return;
    }
    colUsers.innerHTML = shown
      .map((u) => {
        const orderCount = (ordersByUser.get(u.id) || []).length;
        const selected = selectedUser && selectedUser.id === u.id ? "rel-selected" : "";
        return (
          '<div class="rel-row ' +
          selected +
          '" data-user-id="' +
          u.id +
          '"><div class="rel-title">' +
          escapeHtml(u.firstName) +
          " " +
          escapeHtml(u.lastName) +
          '</div><div class="rel-sub">' +
          escapeHtml(u.email) +
          " &middot; " +
          orderCount +
          " order" +
          (orderCount === 1 ? "" : "s") +
          '</div><div class="rel-chevron">&rsaquo;</div></div>'
        );
      })
      .join("");
    if (filtered.length > USER_LIST_CAP) {
      colUsers.innerHTML += '<div class="rel-empty">Showing first ' + USER_LIST_CAP + " of " + filtered.length + " matches -- narrow your search.</div>";
    }
  }

  function renderOrders() {
    const list = (selectedUser ? ordersByUser.get(selectedUser.id) : []) || [];
    if (list.length === 0) {
      colOrders.innerHTML = '<div class="rel-empty">This user has no orders.</div>';
      return;
    }
    colOrders.innerHTML = list
      .map((o) => {
        const selected = selectedOrder && selectedOrder.id === o.id ? "rel-selected" : "";
        const itemCount = (o.items || []).length;
        return (
          '<div class="rel-row ' +
          selected +
          '" data-order-id="' +
          o.id +
          '"><div class="rel-title">#' +
          shortId(o.id) +
          " " +
          statusBadge(o.status) +
          '</div><div class="rel-sub">' +
          String(o.createdAt).slice(0, 10) +
          " &middot; " +
          money(o.total, o.currency) +
          " &middot; " +
          itemCount +
          " item" +
          (itemCount === 1 ? "" : "s") +
          '</div><div class="rel-chevron">&rsaquo;</div></div>'
        );
      })
      .join("");
  }

  function renderShipmentsAndReturns() {
    const shipmentList = (selectedOrder ? shipmentsByOrder.get(selectedOrder.id) : []) || [];
    const returnList = (selectedOrder ? returnsByOrder.get(selectedOrder.id) : []) || [];

    colShipments.innerHTML = shipmentList.length
      ? shipmentList
          .map((s) => {
            const selected = selectedShipment && selectedShipment.id === s.id ? "rel-selected" : "";
            const label = shipmentList.length > 1 ? "Package " + (s.packageIndex + 1) + " of " + s.totalPackages : s.carrier;
            return (
              '<div class="rel-row rel-leaf ' +
              selected +
              '" data-shipment-id="' +
              s.id +
              '"><div class="rel-title">' +
              escapeHtml(label) +
              " " +
              (s.delayed ? '<span class="rel-badge warn">delayed</span>' : statusBadge(s.status)) +
              '</div><div class="rel-sub">' +
              escapeHtml(s.carrier) +
              " &middot; " +
              escapeHtml(s.trackingNumber) +
              "</div></div>"
            );
          })
          .join("")
      : '<div class="rel-empty">No shipments for this order.</div>';

    colReturns.innerHTML = returnList.length
      ? returnList
          .map((r) => {
            const selected = selectedReturn && selectedReturn.id === r.id ? "rel-selected" : "";
            return (
              '<div class="rel-row rel-leaf ' +
              selected +
              '" data-return-id="' +
              r.id +
              '"><div class="rel-title">' +
              escapeHtml(r.reason) +
              " " +
              statusBadge(r.status) +
              '</div><div class="rel-sub">' +
              String(r.requestedAt).slice(0, 10) +
              " &middot; refund " +
              escapeHtml(r.refundAmountFormatted != null ? r.refundAmountFormatted : "") +
              "</div></div>"
            );
          })
          .join("")
      : '<div class="rel-empty">No return request for this order.</div>';
  }

  function renderShipmentDetail(s) {
    const timeline = (s.events || [])
      .map(
        (e) =>
          '<div class="rel-timeline-item"><div class="rel-t-status">' +
          escapeHtml(e.status) +
          '</div><div class="rel-t-meta">' +
          String(e.timestamp).slice(0, 16).replace("T", " ") +
          " &middot; " +
          escapeHtml(e.location) +
          "</div></div>"
      )
      .join("");
    detailEl.innerHTML =
      "<h2>Shipment " +
      shortId(s.id) +
      '</h2><div class="rel-detail-sub">Order #' +
      shortId(s.orderId) +
      '</div><div class="rel-kv-grid">' +
      '<div class="rel-kv"><div class="rel-k">Carrier</div><div class="rel-v">' +
      escapeHtml(s.carrier) +
      '</div></div><div class="rel-kv"><div class="rel-k">Tracking number</div><div class="rel-v">' +
      escapeHtml(s.trackingNumber) +
      '</div></div><div class="rel-kv"><div class="rel-k">Status</div><div class="rel-v">' +
      statusBadge(s.status) +
      (s.delayed ? ' <span class="rel-badge warn">delayed</span>' : "") +
      '</div></div><div class="rel-kv"><div class="rel-k">Package</div><div class="rel-v">' +
      (s.packageIndex + 1) +
      " of " +
      s.totalPackages +
      '</div></div></div><div class="rel-kv"><div class="rel-k">Tracking history</div></div><div class="rel-timeline">' +
      timeline +
      "</div>";
  }

  function renderReturnDetail(r) {
    detailEl.innerHTML =
      "<h2>Return request " +
      shortId(r.id) +
      '</h2><div class="rel-detail-sub">Order #' +
      shortId(r.orderId) +
      '</div><div class="rel-kv-grid">' +
      '<div class="rel-kv"><div class="rel-k">Reason</div><div class="rel-v">' +
      escapeHtml(r.reason) +
      '</div></div><div class="rel-kv"><div class="rel-k">Status</div><div class="rel-v">' +
      statusBadge(r.status) +
      '</div></div><div class="rel-kv"><div class="rel-k">Refund amount</div><div class="rel-v">' +
      escapeHtml(r.refundAmountFormatted != null ? r.refundAmountFormatted : "") +
      '</div></div><div class="rel-kv"><div class="rel-k">Requested</div><div class="rel-v">' +
      String(r.requestedAt).slice(0, 10) +
      '</div></div><div class="rel-kv"><div class="rel-k">Resolved</div><div class="rel-v">' +
      (r.resolvedAt ? String(r.resolvedAt).slice(0, 10) : "not yet") +
      "</div></div>" +
      (r.csatScore !== undefined ? '<div class="rel-kv"><div class="rel-k">CSAT score</div><div class="rel-v">' + r.csatScore + "/5</div></div>" : "") +
      "</div>";
  }

  function renderBreadcrumb() {
    const parts = [];
    if (selectedUser) parts.push(escapeHtml(selectedUser.firstName) + " " + escapeHtml(selectedUser.lastName));
    if (selectedOrder) parts.push("Order #" + shortId(selectedOrder.id));
    if (selectedShipment) parts.push("Shipment (" + escapeHtml(selectedShipment.carrier) + ")");
    if (selectedReturn) parts.push("Return (" + escapeHtml(selectedReturn.reason) + ")");
    breadcrumbEl.innerHTML = parts.length
      ? parts.map((p) => '<span class="rel-crumb">' + p + "</span>").join('<span class="rel-sep">/</span>')
      : '<span class="rel-crumb">Pick a user to start exploring</span>';
  }

  colUsers.addEventListener("click", (e) => {
    const row = e.target.closest("[data-user-id]");
    if (!row) return;
    selectedUser = users.find((u) => u.id === row.getAttribute("data-user-id"));
    resetDownstream("user");
    renderUsers(searchEl.value);
    renderOrders();
    renderBreadcrumb();
  });
  colOrders.addEventListener("click", (e) => {
    const row = e.target.closest("[data-order-id]");
    if (!row) return;
    selectedOrder = orders.find((o) => o.id === row.getAttribute("data-order-id"));
    resetDownstream("order");
    renderOrders();
    renderShipmentsAndReturns();
    renderBreadcrumb();
  });
  colShipments.addEventListener("click", (e) => {
    const row = e.target.closest("[data-shipment-id]");
    if (!row) return;
    selectedShipment = shipments.find((s) => s.id === row.getAttribute("data-shipment-id"));
    selectedReturn = null;
    renderShipmentsAndReturns();
    renderShipmentDetail(selectedShipment);
    renderBreadcrumb();
  });
  colReturns.addEventListener("click", (e) => {
    const row = e.target.closest("[data-return-id]");
    if (!row) return;
    selectedReturn = returnRequests.find((r) => r.id === row.getAttribute("data-return-id"));
    selectedShipment = null;
    renderShipmentsAndReturns();
    renderReturnDetail(selectedReturn);
    renderBreadcrumb();
  });
  searchEl.addEventListener("input", () => renderUsers(searchEl.value));

  window.__ecoFakerRelationshipExplorer = { renderUsers, selectedUser: () => selectedUser };

  renderUsers("");
  resetDownstream("user");
  renderBreadcrumb();
})();
`;

const RELATIONSHIP_STYLE = `
  .rel-columns { display: flex; gap: 10px; margin-top: 10px; }
  .rel-col { flex: 1; min-width: 0; border: 1px solid var(--vscode-panel-border, #444); border-radius: 4px; max-height: 420px; overflow-y: auto; }
  .rel-row { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border, #333); cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .rel-row:hover { background: var(--vscode-list-hoverBackground, #2a2a2a); }
  .rel-row.rel-selected { background: var(--vscode-list-activeSelectionBackground, #094771); }
  .rel-title { flex: 1; font-weight: 600; font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rel-sub { font-size: 0.75em; opacity: 0.75; flex-basis: 100%; }
  .rel-chevron { opacity: 0.5; }
  .rel-empty, .rel-placeholder { padding: 10px; opacity: 0.6; font-size: 0.85em; }
  .rel-badge { font-size: 0.75em; padding: 1px 6px; border-radius: 3px; }
  .rel-badge.ok { background: #2ea04326; color: #4caf50; }
  .rel-badge.bad { background: #f8514926; color: #f85149; }
  .rel-badge.warn { background: #f59e0b26; color: #f59e0b; }
  #rel-breadcrumb { margin: 10px 0 4px; font-size: 0.85em; }
  .rel-crumb { opacity: 0.9; }
  .rel-sep { opacity: 0.4; margin: 0 6px; }
  #rel-detail { margin-top: 10px; padding: 10px; border: 1px solid var(--vscode-panel-border, #444); border-radius: 4px; min-height: 80px; }
  .rel-kv-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  .rel-kv { min-width: 140px; }
  .rel-k { font-size: 0.7em; opacity: 0.6; text-transform: uppercase; }
  .rel-v { font-size: 0.9em; }
  .rel-timeline-item { padding: 4px 0; border-left: 2px solid var(--vscode-panel-border, #444); padding-left: 8px; margin-bottom: 4px; }
  .rel-t-status { font-weight: 600; font-size: 0.85em; }
  .rel-t-meta { font-size: 0.75em; opacity: 0.7; }
  .eco-tabs { margin-bottom: 4px; }
  .eco-tabs button { background: none; border: 1px solid var(--vscode-panel-border, #444); cursor: pointer; padding: 4px 10px; color: inherit; font-family: inherit; }
  .eco-tabs button.eco-tab-active { background: var(--vscode-list-activeSelectionBackground, #094771); }
`;

const STYLE = `
  body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #1e1e1e); padding: 12px; }
  select, input, button { font-family: inherit; padding: 4px 8px; margin-right: 8px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 0.85em; }
  th, td { border: 1px solid var(--vscode-panel-border, #444); padding: 4px 8px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
  th { cursor: pointer; user-select: none; position: sticky; top: 0; background: var(--vscode-editor-background, #1e1e1e); }
  #page-info { margin: 8px 0; opacity: 0.8; }
`;

/**
 * Builds a fully self-contained webview HTML document -- the entire
 * dataset is embedded as JSON and every interaction (table switching,
 * search, sort, pagination) runs client-side with no message-passing
 * back to the extension host, the same "no server, entirely client-side"
 * approach the project's own web-static/explorer.html already uses.
 *
 * Deliberately not paginated server-side or streamed -- fine for the
 * modest, hundreds-to-low-thousands-of-rows-per-table datasets this tool
 * is meant for local dev use with; a dataset generated at a much larger
 * scaleFactor would mean a correspondingly large embedded JSON blob, not
 * something this first slice tries to handle.
 */
export function buildTableViewerHtml(dataset: DatasetTables): string {
  const tableNames = Object.keys(dataset)
    .filter((name) => Array.isArray(dataset[name]))
    .sort();
  const options = tableNames.map((name) => `<option value="${name}">${name} (${dataset[name].length})</option>`).join("");

  // JSON.stringify(dataset) embedded raw inside a <script> tag breaks (and
  // is exploitable) the instant any string value in the dataset contains
  // a literal "</script>" substring -- the HTML parser, not the JS parser,
  // sees that sequence and closes the script tag right there, corrupting
  // everything after it. Caught directly: a dataset with a note field
  // containing "<script>alert(1)</script>" produced a real
  // "ReferenceError: DATASET is not defined" when actually loaded in
  // jsdom. Escaping "<" to its unicode escape is the standard mitigation
  // (the same one React/Next.js use for this exact situation) -- JSON and
  // JS parsers both read \u003c identically to a literal "<", but the HTML
  // parser never sees a tag-opening character to react to.
  const embeddedDataset = JSON.stringify(dataset).replace(/</g, "\\u003c");

  // The relationship drill-down assumes a specific shape -- real users,
  // real orders referencing them, real shipments referencing those
  // orders. A dataset missing any of these (a partial export, or simply
  // not an eco-faker e-commerce dataset at all) gets an honest disabled
  // tab explaining why, rather than a tab that opens onto three empty
  // columns with no indication anything's wrong.
  const hasRelationshipShape =
    Array.isArray(dataset.users) &&
    dataset.users.length > 0 &&
    Array.isArray(dataset.orders) &&
    dataset.orders.length > 0 &&
    Array.isArray(dataset.shipments) &&
    dataset.shipments.length > 0;

  const relationshipsTabButton = hasRelationshipShape
    ? `<button id="eco-tab-btn-relationships">Relationships</button>`
    : `<button id="eco-tab-btn-relationships" disabled title="Needs non-empty users, orders, and shipments tables in this dataset">Relationships</button>`;

  const relationshipsPane = hasRelationshipShape
    ? `<div id="rel-breadcrumb"></div>
  <input id="rel-search" type="text" placeholder="Search users by name or email...">
  <div class="rel-columns">
    <div class="rel-col" id="rel-col-users"></div>
    <div class="rel-col" id="rel-col-orders"></div>
    <div class="rel-col" id="rel-col-shipments"></div>
    <div class="rel-col" id="rel-col-returns"></div>
  </div>
  <div id="rel-detail"></div>`
    : `<div class="rel-empty">This dataset doesn't have non-empty users/orders/shipments tables to relate -- the flat table view above still shows everything it does have.</div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${STYLE}${RELATIONSHIP_STYLE}</style>
</head>
<body>
  <div class="eco-tabs">
    <button id="eco-tab-btn-tables" class="eco-tab-active">Tables</button>
    ${relationshipsTabButton}
  </div>

  <div id="eco-tab-tables">
    <select id="table-select">${options}</select>
    <input id="search-box" type="text" placeholder="Search all columns...">
    <button id="prev-page">&laquo; Prev</button>
    <button id="next-page">Next &raquo;</button>
    <div id="page-info"></div>
    <table>
      <thead id="table-head"></thead>
      <tbody id="table-body"></tbody>
    </table>
  </div>

  <div id="eco-tab-relationships" style="display: none;">
    ${relationshipsPane}
  </div>

  <script>
    window.DATASET = ${embeddedDataset};
    window.__ecoFakerHasRelationshipShape = ${hasRelationshipShape};
  </script>
  <script>${CLIENT_SCRIPT}</script>
  <script>${CLIENT_SCRIPT_RELATIONSHIPS}</script>
  <script>
    (function () {
      var tabTables = document.getElementById("eco-tab-btn-tables");
      var tabRel = document.getElementById("eco-tab-btn-relationships");
      var paneTables = document.getElementById("eco-tab-tables");
      var paneRel = document.getElementById("eco-tab-relationships");
      function activate(which) {
        if (which === "relationships") {
          paneTables.style.display = "none";
          paneRel.style.display = "block";
          tabTables.classList.remove("eco-tab-active");
          tabRel.classList.add("eco-tab-active");
        } else {
          paneRel.style.display = "none";
          paneTables.style.display = "block";
          tabRel.classList.remove("eco-tab-active");
          tabTables.classList.add("eco-tab-active");
        }
      }
      tabTables.addEventListener("click", function () { activate("tables"); });
      if (tabRel && !tabRel.disabled) tabRel.addEventListener("click", function () { activate("relationships"); });
    })();
  </script>
</body>
</html>`;
}

/** Reads a dataset written by `generate --format json` -- already excludes the internal `config` field, so every top-level key here is a real table. */
export function loadDatasetTables(rawJson: string): DatasetTables {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const tables: DatasetTables = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) tables[key] = value;
  }
  return tables;
}
