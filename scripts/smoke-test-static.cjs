const vm = require("vm");
const fs = require("fs");

function makeEl(id) {
  const el = {
    id,
    value: "150",
    max: "1000",
    min: "10",
    textContent: "",
    innerHTML: "",
    children: [],
    listeners: {},
    style: {},
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    appendChild(child) {
      this.children.push(child);
    },
    insertBefore(child) {
      this.children.unshift(child);
    },
    getContext() {
      return {};
    },
  };
  return el;
}

const registry = new Map();
function getOrCreate(id) {
  if (!registry.has(id)) registry.set(id, makeEl(id));
  return registry.get(id);
}

// Pre-seed the elements the app expects to already exist in the HTML.
["scaleFactor", "abandonmentRate", "delayProbability", "returnRate", "multiPackageRate", "scenario", "stats", "anomalies", "elapsed", "cartChart", "shipmentChart", "revenueChart"].forEach(
  getOrCreate
);
["val-scaleFactor", "val-abandonmentRate", "val-delayProbability", "val-returnRate", "val-multiPackageRate"].forEach(getOrCreate);

// Give sliders sane default values matching the real HTML.
getOrCreate("scaleFactor").value = "150";
getOrCreate("abandonmentRate").value = "0.35";
getOrCreate("abandonmentRate").max = "1";
getOrCreate("delayProbability").value = "0.15";
getOrCreate("delayProbability").max = "1";
getOrCreate("returnRate").value = "0.08";
getOrCreate("returnRate").max = "1";
getOrCreate("multiPackageRate").value = "0.1";
getOrCreate("multiPackageRate").max = "1";

let chartInstances = 0;
function FakeChart(ctx, config) {
  chartInstances++;
  this.data = config.data;
  this.update = () => {};
}

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Intl,
  performance: { now: () => Date.now() },
  setTimeout,
  clearTimeout,
  Chart: FakeChart,
  document: {
    getElementById: (id) => registry.get(id) ?? null,
    createElement: () => makeEl("option"),
  },
};
vm.createContext(sandbox);

const code = fs.readFileSync("web-static/dist/bundle.js", "utf8");
vm.runInContext(code, sandbox);

const stats = registry.get("stats");
if (!stats.innerHTML.includes("Users")) throw new Error("stats panel was not rendered");
if (chartInstances !== 3) throw new Error(`expected 3 charts, got ${chartInstances}`);
const scenarioEl = registry.get("scenario");
if (scenarioEl.children.length < 5) throw new Error("scenario dropdown wasn't populated");

console.log("OK: static bundle ran against a fake DOM, rendered stats + 3 charts + scenario dropdown.");
