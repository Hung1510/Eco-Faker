import { generate, SCENARIOS } from "../../src/browser.js";
import type { Dataset } from "../../src/browser.js";

declare const Chart: any;

const sliders = ["scaleFactor", "abandonmentRate", "delayProbability", "returnRate", "multiPackageRate"] as const;
type SliderId = (typeof sliders)[number];

const els = Object.fromEntries(sliders.map((id) => [id, document.getElementById(id) as HTMLInputElement])) as Record<
  SliderId,
  HTMLInputElement
>;
const valueEls = Object.fromEntries(sliders.map((id) => [id, document.getElementById("val-" + id)!])) as Record<
  SliderId,
  HTMLElement
>;
const scenarioSelect = document.getElementById("scenario") as HTMLSelectElement;

let cartChart: any, shipmentChart: any, revenueChart: any;
let debounceHandle: ReturnType<typeof setTimeout> | undefined;

// Populate the scenario dropdown from the real SCENARIOS export -- if a
// new preset is added to the library, the static demo picks it up for free.
for (const name of Object.keys(SCENARIOS)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  scenarioSelect.appendChild(option);
}
const customOption = document.createElement("option");
customOption.value = "";
customOption.textContent = "custom (sliders below)";
customOption.selected = true;
scenarioSelect.insertBefore(customOption, scenarioSelect.firstChild);

function currentOverrides() {
  const scenario = scenarioSelect.value ? SCENARIOS[scenarioSelect.value as keyof typeof SCENARIOS] : {};
  return {
    ...scenario,
    scaleFactor: Number(els.scaleFactor.value),
    abandonmentRate: Number(els.abandonmentRate.value),
    delayProbability: Number(els.delayProbability.value),
    returnRate: Number(els.returnRate.value),
    multiPackageRate: Number(els.multiPackageRate.value),
    seed: 42,
  };
}

function paintSliderValues() {
  for (const id of sliders) {
    valueEls[id].textContent = Number(els[id].value).toFixed(id === "scaleFactor" ? 0 : 2);
  }
}

function summarize(dataset: Dataset, elapsedMs: number) {
  const cartStatusBreakdown: Record<string, number> = { active: 0, abandoned: 0, converted: 0 };
  for (const cart of dataset.carts) cartStatusBreakdown[cart.status]++;

  const shipmentStatusBreakdown: Record<string, number> = {
    "Label Created": 0,
    "Picked Up": 0,
    "In Transit": 0,
    "Out for Delivery": 0,
    Delivered: 0,
  };
  for (const shipment of dataset.shipments) {
    shipmentStatusBreakdown[shipment.status] = (shipmentStatusBreakdown[shipment.status] ?? 0) + 1;
  }

  const revenueByDay = new Map<string, number>();
  for (const order of dataset.orders) {
    const day = order.createdAt.slice(0, 10);
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + order.total);
  }
  const revenueSeries = [...revenueByDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }));

  const anomalyCounts = {
    botCarts: dataset.carts.filter((c) => c.anomaly?.type === "bot_activity").length,
    remoteShippingOrders: dataset.orders.filter((o) => o.anomaly?.type === "remote_surcharge").length,
    contradictoryReturns: dataset.returnRequests.filter((r) => r.anomaly?.type === "contradictory_review").length,
  };

  return {
    counts: {
      users: dataset.users.length,
      carts: dataset.carts.length,
      abandonedCheckouts: dataset.abandonedCheckouts.length,
      orders: dataset.orders.length,
      shipments: dataset.shipments.length,
      returnRequests: dataset.returnRequests.length,
    },
    cartStatusBreakdown,
    shipmentStatusBreakdown,
    revenueSeries,
    anomalyCounts,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
  };
}

function upsertChart(existing: any, canvasId: string, type: string, chartData: any, extraOptions: any = {}) {
  if (existing) {
    existing.data = chartData;
    existing.update();
    return existing;
  }
  const ctx = (document.getElementById(canvasId) as HTMLCanvasElement).getContext("2d");
  return new Chart(ctx, { type, data: chartData, options: { responsive: true, maintainAspectRatio: false, ...extraOptions } });
}

function renderStats(data: ReturnType<typeof summarize>) {
  const c = data.counts;
  document.getElementById("stats")!.innerHTML = [
    ["Users", c.users],
    ["Carts", c.carts],
    ["Abandoned", c.abandonedCheckouts],
    ["Orders", c.orders],
    ["Shipments", c.shipments],
    ["Returns", c.returnRequests],
  ]
    .map(([label, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${label}</div></div>`)
    .join("");

  document.getElementById("anomalies")!.innerHTML = [
    `${data.anomalyCounts.botCarts} bot carts`,
    `${data.anomalyCounts.remoteShippingOrders} remote-shipping surcharges`,
    `${data.anomalyCounts.contradictoryReturns} contradictory returns`,
  ]
    .map((t) => `<span class="badge">${t}</span>`)
    .join("");

  document.getElementById("elapsed")!.textContent = `Generated in ${data.elapsedMs}ms -- entirely in your browser, no server involved.`;
}

function renderCharts(data: ReturnType<typeof summarize>) {
  const palette = ["#6ee7b7", "#f59e0b", "#f87171", "#60a5fa", "#c084fc"];

  cartChart = upsertChart(cartChart, "cartChart", "pie", {
    labels: Object.keys(data.cartStatusBreakdown),
    datasets: [{ data: Object.values(data.cartStatusBreakdown), backgroundColor: palette }],
  });

  const shipmentLabels = Object.keys(data.shipmentStatusBreakdown);
  shipmentChart = upsertChart(
    shipmentChart,
    "shipmentChart",
    "bar",
    {
      labels: shipmentLabels,
      datasets: [
        {
          label: "Shipments",
          data: Object.values(data.shipmentStatusBreakdown),
          backgroundColor: shipmentLabels.map((l) => (l === "Delayed" ? "#f87171" : "#6ee7b7")),
        },
      ],
    },
    { plugins: { legend: { display: false } } }
  );

  revenueChart = upsertChart(
    revenueChart,
    "revenueChart",
    "bar",
    {
      labels: data.revenueSeries.map((d) => d.date),
      datasets: [{ label: "Revenue ($)", data: data.revenueSeries.map((d) => d.revenue), backgroundColor: "#60a5fa" }],
    },
    { plugins: { legend: { display: false } } }
  );
}

function applyScenarioToSliders() {
  if (!scenarioSelect.value) return;
  const scenario = SCENARIOS[scenarioSelect.value as keyof typeof SCENARIOS] as Record<string, unknown>;
  const fieldMap: Record<SliderId, string> = {
    scaleFactor: "scaleFactor",
    abandonmentRate: "abandonmentRate",
    delayProbability: "delayProbability",
    returnRate: "returnRate",
    multiPackageRate: "multiPackageRate",
  };
  for (const id of sliders) {
    const value = scenario[fieldMap[id]];
    if (typeof value === "number") els[id].value = String(Math.min(Number(els[id].max), value));
  }
}

function refresh() {
  paintSliderValues();
  const start = performance.now();
  const dataset = generate(currentOverrides(), Date.parse("2026-01-01T00:00:00Z"));
  const elapsedMs = performance.now() - start;
  const data = summarize(dataset, elapsedMs);
  renderStats(data);
  renderCharts(data);
}

for (const id of sliders) {
  els[id].addEventListener("input", () => {
    paintSliderValues();
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(refresh, 100);
  });
}
scenarioSelect.addEventListener("change", () => {
  applyScenarioToSliders();
  refresh();
});

refresh();
