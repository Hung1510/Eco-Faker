const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// Strip the Chart.js CDN <script> tag -- jsdom would try to fetch it over
// a real network request to cdn.jsdelivr.net, which isn't reachable from
// every environment this test might run in (this project's own sandbox
// included). A minimal fake Chart constructor is injected instead, same
// as the previous version of this test did.
const html = fs
  .readFileSync(path.join(__dirname, "..", "web-static", "index.html"), "utf8")
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/, "")
  .replace(/<script src="\.\/dist\/bundle\.js"><\/script>/, "");

const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/index.html" });
const { window } = dom;

let chartInstances = 0;
window.Chart = function FakeChart(_ctx, config) {
  chartInstances++;
  this.data = config.data;
  this.update = () => {};
};
// jsdom doesn't implement canvas 2D context by default -- stub it so
// `canvas.getContext("2d")` doesn't throw.
window.HTMLCanvasElement.prototype.getContext = () => ({});

function waitFor(predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function main() {
  const bundleCode = fs.readFileSync(path.join(__dirname, "..", "web-static", "dist", "bundle.js"), "utf8");
  window.eval(bundleCode);

  const doc = window.document;
  await waitFor(() => doc.getElementById("elapsed")?.textContent?.includes("Generated in"));

  const stats = doc.getElementById("stats");
  if (!stats.innerHTML.includes("Users")) throw new Error("stats panel was not rendered");
  console.log("OK: stats panel rendered");

  if (chartInstances !== 3) throw new Error(`expected 3 charts, got ${chartInstances}`);
  console.log("OK: 3 charts constructed");

  const scenarioEl = doc.getElementById("scenario");
  if (scenarioEl.children.length < 5) throw new Error("scenario dropdown wasn't populated");
  console.log("OK: scenario dropdown populated with", scenarioEl.children.length, "options");

  // Regression check: the dropdown must default to the empty "custom"
  // option, not silently fall back to whichever real scenario happened
  // to be inserted first. Setting `.selected = true` on an <option>
  // before it's attached to its <select> doesn't reliably survive
  // insertion -- this was a real bug (the dropdown visually showed
  // "black-friday" selected on load instead of "custom (sliders
  // below)"), undetected for as long as this test used a hand-rolled
  // fake DOM that didn't implement real <select> selection semantics.
  if (scenarioEl.value !== "") {
    throw new Error(`scenario dropdown should default to "custom" (value ""), got "${scenarioEl.value}"`);
  }
  console.log("OK: scenario dropdown correctly defaults to the custom option, not a real scenario preset");

  // New: module toggle checkboxes and the live config/CLI output panel.
  const configOutput = doc.getElementById("configOutput");
  if (!configOutput.textContent.includes("my-eco-gen generate")) {
    throw new Error("config output panel didn't render a CLI command");
  }
  if (!configOutput.textContent.includes("--users")) {
    throw new Error("config output panel's CLI command is missing --users");
  }
  console.log("OK: config/CLI output panel rendered with a real CLI command");

  // With every module checked (the default), no --no-* flags should appear.
  if (/--no-/.test(configOutput.textContent)) {
    throw new Error(`expected no --no-* flags with every module checked, got: ${configOutput.textContent}`);
  }
  console.log("OK: no --no-* flags shown while every module toggle is checked");

  // Unchecking a module toggle should add its real --no-* flag to the
  // output AND actually remove that data from the generated stats -- not
  // just flip a checkbox with no real effect.
  const recToggle = doc.getElementById("mod-recommendationData");
  recToggle.checked = false;
  recToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => configOutput.textContent.includes("--no-recommendation-data"));
  console.log("OK: unchecking a module toggle adds its real --no-* CLI flag");

  const supportToggle = doc.getElementById("mod-supportTickets");
  supportToggle.checked = false;
  supportToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => configOutput.textContent.includes("--no-support-tickets"));
  if (!configOutput.textContent.includes("--no-recommendation-data")) {
    throw new Error("expected BOTH --no-recommendation-data and --no-support-tickets after unchecking two toggles, got: " + configOutput.textContent);
  }
  console.log("OK: multiple unchecked toggles all appear together, not just the most recent one");

  console.log("\nAll static playground smoke tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
