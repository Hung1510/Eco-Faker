import { generate, SCENARIOS } from "../../src/browser.js";
import type { Dataset, User, Order, Shipment, ReturnRequest } from "../../src/browser.js";

const scenarioSelect = document.getElementById("scenario") as HTMLSelectElement;
const regenButton = document.getElementById("regen") as HTMLButtonElement;
const userSearch = document.getElementById("userSearch") as HTMLInputElement;
const statusEl = document.getElementById("status")!;
const breadcrumbEl = document.getElementById("breadcrumb")!;
const colUsers = document.getElementById("col-users")!;
const colOrders = document.getElementById("col-orders")!;
const colShipments = document.getElementById("col-shipments")!;
const colReturns = document.getElementById("col-returns")!;
const detailEl = document.getElementById("detail")!;

const USER_LIST_CAP = 300;

let dataset: Dataset;
let ordersByUser: Map<string, Order[]>;
let shipmentsByOrder: Map<string, Shipment[]>;
let returnsByOrder: Map<string, ReturnRequest[]>;

let selectedUser: User | null = null;
let selectedOrder: Order | null = null;
let selectedShipment: Shipment | null = null;
let selectedReturn: ReturnRequest | null = null;

for (const name of Object.keys(SCENARIOS)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  scenarioSelect.appendChild(option);
}
const customOption = document.createElement("option");
customOption.value = "";
customOption.textContent = "custom (default tuning)";
scenarioSelect.insertBefore(customOption, scenarioSelect.firstChild);
// Setting .selected = true before an option is attached to its <select>
// doesn't reliably survive insertion -- explicitly forcing .value after
// every option exists is the reliable way to select it. A real bug this
// project's original static playground (app.ts) also had, silently,
// because its smoke test's hand-rolled fake DOM never implemented real
// <select> selection semantics to catch it.
scenarioSelect.value = "";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function buildIndices(ds: Dataset) {
  ordersByUser = new Map();
  for (const order of ds.orders) {
    const list = ordersByUser.get(order.userId) ?? [];
    list.push(order);
    ordersByUser.set(order.userId, list);
  }
  shipmentsByOrder = new Map();
  for (const shipment of ds.shipments) {
    const list = shipmentsByOrder.get(shipment.orderId) ?? [];
    list.push(shipment);
    shipmentsByOrder.set(shipment.orderId, list);
  }
  returnsByOrder = new Map();
  for (const ret of ds.returnRequests) {
    const list = returnsByOrder.get(ret.orderId) ?? [];
    list.push(ret);
    returnsByOrder.set(ret.orderId, list);
  }
}

function statusBadge(status: string): string {
  const cls = status === "delivered" || status === "Delivered" || status === "resolved" ? "ok"
    : status === "cancelled" || status === "rejected" ? "bad"
    : "warn";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function resetDownstream(from: "user" | "order") {
  if (from === "user") {
    selectedOrder = null;
    colOrders.innerHTML = '<div class="empty-hint">Select a user to see their orders.</div>';
  }
  selectedShipment = null;
  selectedReturn = null;
  colShipments.innerHTML = '<div class="empty-hint">Select an order to see its shipment(s).</div>';
  colReturns.innerHTML = '<div class="empty-hint">Select an order to see any return request.</div>';
  detailEl.innerHTML = '<div class="placeholder">Select a shipment or return request above for full tracking / return details.</div>';
}

function renderUsers(filterText: string) {
  const filtered = filterText
    ? dataset.users.filter((u) => {
        const haystack = `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase();
        return haystack.includes(filterText.toLowerCase());
      })
    : dataset.users;
  const shown = filtered.slice(0, USER_LIST_CAP);

  if (shown.length === 0) {
    colUsers.innerHTML = '<div class="empty-hint">No users match that filter.</div>';
    return;
  }

  colUsers.innerHTML = shown
    .map((u) => {
      const orderCount = ordersByUser.get(u.id)?.length ?? 0;
      const selected = selectedUser?.id === u.id ? "selected" : "";
      return `<div class="row ${selected}" data-user-id="${u.id}">
        <div class="title">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
        <div class="sub">${escapeHtml(u.email)} &middot; ${orderCount} order${orderCount === 1 ? "" : "s"}</div>
        <div class="chevron">&rsaquo;</div>
      </div>`;
    })
    .join("");

  if (filtered.length > USER_LIST_CAP) {
    colUsers.innerHTML += `<div class="empty-hint">Showing first ${USER_LIST_CAP} of ${filtered.length} matches -- narrow your search.</div>`;
  }
}

function renderOrders() {
  const orders = (selectedUser ? ordersByUser.get(selectedUser.id) : []) ?? [];
  if (orders.length === 0) {
    colOrders.innerHTML = '<div class="empty-hint">This user has no orders.</div>';
    return;
  }
  colOrders.innerHTML = orders
    .map((o) => {
      const selected = selectedOrder?.id === o.id ? "selected" : "";
      return `<div class="row ${selected}" data-order-id="${o.id}">
        <div class="title">#${shortId(o.id)} ${statusBadge(o.status)}</div>
        <div class="sub">${o.createdAt.slice(0, 10)} &middot; ${money(o.total, o.currency)} &middot; ${o.items.length} item${o.items.length === 1 ? "" : "s"}</div>
        <div class="chevron">&rsaquo;</div>
      </div>`;
    })
    .join("");
}

function renderShipmentsAndReturns() {
  const shipments = (selectedOrder ? shipmentsByOrder.get(selectedOrder.id) : []) ?? [];
  const returns = (selectedOrder ? returnsByOrder.get(selectedOrder.id) : []) ?? [];

  colShipments.innerHTML = shipments.length
    ? shipments
        .map((s) => {
          const selected = selectedShipment?.id === s.id ? "selected" : "";
          const label = shipments.length > 1 ? `Package ${s.packageIndex + 1} of ${s.totalPackages}` : s.carrier;
          return `<div class="row leaf ${selected}" data-shipment-id="${s.id}">
        <div class="title">${escapeHtml(label)} ${s.delayed ? '<span class="badge warn">delayed</span>' : statusBadge(s.status)}</div>
        <div class="sub">${escapeHtml(s.carrier)} &middot; ${escapeHtml(s.trackingNumber)}</div>
      </div>`;
        })
        .join("")
    : '<div class="empty-hint">No shipments for this order.</div>';

  colReturns.innerHTML = returns.length
    ? returns
        .map((r) => {
          const selected = selectedReturn?.id === r.id ? "selected" : "";
          return `<div class="row leaf ${selected}" data-return-id="${r.id}">
        <div class="title">${escapeHtml(r.reason)} ${statusBadge(r.status)}</div>
        <div class="sub">${r.requestedAt.slice(0, 10)} &middot; refund ${r.refundAmountFormatted}</div>
      </div>`;
        })
        .join("")
    : '<div class="empty-hint">No return request for this order.</div>';
}

function renderShipmentDetail(s: Shipment) {
  const timeline = s.events
    .map(
      (e) => `<div class="timeline-item">
      <div class="t-status">${escapeHtml(e.status)}</div>
      <div class="t-meta">${e.timestamp.slice(0, 16).replace("T", " ")} &middot; ${escapeHtml(e.location)}</div>
    </div>`
    )
    .join("");

  detailEl.innerHTML = `
    <h2>Shipment ${shortId(s.id)}</h2>
    <div class="detail-sub">Order #${shortId(s.orderId)}</div>
    <div class="kv-grid">
      <div class="kv"><div class="k">Carrier</div><div class="v">${escapeHtml(s.carrier)}</div></div>
      <div class="kv"><div class="k">Tracking number</div><div class="v">${escapeHtml(s.trackingNumber)}</div></div>
      <div class="kv"><div class="k">Status</div><div class="v">${statusBadge(s.status)}${s.delayed ? ' <span class="badge warn">delayed</span>' : ""}</div></div>
      <div class="kv"><div class="k">Package</div><div class="v">${s.packageIndex + 1} of ${s.totalPackages}</div></div>
    </div>
    <div class="kv"><div class="k">Tracking history</div></div>
    <div class="timeline" style="margin-top:8px;">${timeline}</div>
  `;
}

function renderReturnDetail(r: ReturnRequest) {
  detailEl.innerHTML = `
    <h2>Return request ${shortId(r.id)}</h2>
    <div class="detail-sub">Order #${shortId(r.orderId)}</div>
    <div class="kv-grid">
      <div class="kv"><div class="k">Reason</div><div class="v">${escapeHtml(r.reason)}</div></div>
      <div class="kv"><div class="k">Status</div><div class="v">${statusBadge(r.status)}</div></div>
      <div class="kv"><div class="k">Refund amount</div><div class="v">${r.refundAmountFormatted}</div></div>
      <div class="kv"><div class="k">Requested</div><div class="v">${r.requestedAt.slice(0, 10)}</div></div>
      <div class="kv"><div class="k">Resolved</div><div class="v">${r.resolvedAt ? r.resolvedAt.slice(0, 10) : "not yet"}</div></div>
      ${r.csatScore !== undefined ? `<div class="kv"><div class="k">CSAT score</div><div class="v">${r.csatScore}/5</div></div>` : ""}
    </div>
  `;
}

function renderBreadcrumb() {
  const parts: string[] = [];
  if (selectedUser) parts.push(`${escapeHtml(selectedUser.firstName)} ${escapeHtml(selectedUser.lastName)}`);
  if (selectedOrder) parts.push(`Order #${shortId(selectedOrder.id)}`);
  if (selectedShipment) parts.push(`Shipment (${escapeHtml(selectedShipment.carrier)})`);
  if (selectedReturn) parts.push(`Return (${escapeHtml(selectedReturn.reason)})`);

  if (parts.length === 0) {
    breadcrumbEl.innerHTML = '<span class="crumb">Pick a user to start exploring</span>';
    return;
  }
  breadcrumbEl.innerHTML = parts.map((p) => `<span class="crumb">${p}</span>`).join('<span class="sep">/</span>');
}

function attachEvents() {
  colUsers.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest("[data-user-id]") as HTMLElement | null;
    if (!row) return;
    const user = dataset.users.find((u) => u.id === row.dataset.userId)!;
    selectedUser = user;
    resetDownstream("user");
    renderUsers(userSearch.value);
    renderOrders();
    renderBreadcrumb();
  });

  colOrders.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest("[data-order-id]") as HTMLElement | null;
    if (!row) return;
    const order = dataset.orders.find((o) => o.id === row.dataset.orderId)!;
    selectedOrder = order;
    resetDownstream("order");
    renderOrders();
    renderShipmentsAndReturns();
    renderBreadcrumb();
  });

  colShipments.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest("[data-shipment-id]") as HTMLElement | null;
    if (!row) return;
    const shipment = dataset.shipments.find((s) => s.id === row.dataset.shipmentId)!;
    selectedShipment = shipment;
    selectedReturn = null;
    renderShipmentsAndReturns();
    renderShipmentDetail(shipment);
    renderBreadcrumb();
  });

  colReturns.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest("[data-return-id]") as HTMLElement | null;
    if (!row) return;
    const ret = dataset.returnRequests.find((r) => r.id === row.dataset.returnId)!;
    selectedReturn = ret;
    selectedShipment = null;
    renderShipmentsAndReturns();
    renderReturnDetail(ret);
    renderBreadcrumb();
  });

  userSearch.addEventListener("input", () => renderUsers(userSearch.value));
  regenButton.addEventListener("click", () => generateNewDataset());
  scenarioSelect.addEventListener("change", () => generateNewDataset());
}

function generateNewDataset() {
  const scenario = scenarioSelect.value ? SCENARIOS[scenarioSelect.value as keyof typeof SCENARIOS] : {};
  const start = performance.now();
  dataset = generate({ ...scenario, scaleFactor: 150, seed: Math.floor(Math.random() * 1_000_000) }, Date.parse("2026-01-01T00:00:00Z"));
  const elapsedMs = Math.round((performance.now() - start) * 10) / 10;

  buildIndices(dataset);
  selectedUser = null;
  selectedOrder = null;
  selectedShipment = null;
  selectedReturn = null;

  renderUsers("");
  resetDownstream("user");
  renderBreadcrumb();

  statusEl.textContent = `${dataset.users.length} users, ${dataset.orders.length} orders, ${dataset.shipments.length} shipments, ${dataset.returnRequests.length} return requests -- generated in ${elapsedMs}ms, entirely in your browser.`;
}

attachEvents();
generateNewDataset();
