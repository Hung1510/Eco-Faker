const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "web-static", "mapping-designer.html"), "utf8");
const htmlWithoutScript = html.replace(/<script src="\.\/dist\/mapping-designer-bundle\.js"><\/script>/, "");
const dom = new JSDOM(htmlWithoutScript, { runScripts: "dangerously", resources: "usable", url: "http://localhost/mapping-designer.html" });
const { window } = dom;

// jsdom's Blob/URL.createObjectURL support varies by version -- stub them
// so the download button's click handler doesn't throw, and capture what
// would have been downloaded for real assertions.
let lastDownloadedBlobText = null;
window.URL.createObjectURL = (blob) => {
  lastDownloadedBlobText = blob.__testText;
  return "blob:fake-url";
};
window.URL.revokeObjectURL = () => {};
const OriginalBlob = window.Blob;
window.Blob = class FakeBlob extends OriginalBlob {
  constructor(parts, options) {
    super(parts, options);
    this.__testText = parts.join("");
  }
};

const bundleCode = fs.readFileSync(path.join(__dirname, "..", "web-static", "dist", "mapping-designer-bundle.js"), "utf8");

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

const REAL_SCHEMA = `
model User {
  id        String   @id @default(uuid())
  firstName String
  lastName  String
  email     String   @unique
}

model Order {
  id        String   @id @default(uuid())
  userId    String
  total     Decimal
  status    String
  createdAt DateTime @default(now())
}
`;

async function main() {
  window.eval(bundleCode);
  const doc = window.document;

  const textarea = doc.getElementById("schemaInput");
  textarea.value = REAL_SCHEMA;
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  await waitFor(() => doc.getElementById("modelsFound").children.length > 0);
  const modelsText = doc.getElementById("modelsFound").textContent;
  if (!modelsText.includes("User") || !modelsText.includes("Order")) {
    throw new Error(`expected both User and Order models found, got: ${modelsText}`);
  }
  console.log("OK: real schema parsed, real models rendered:", modelsText.trim());

  if (doc.getElementById("parseError").textContent.trim() !== "") {
    throw new Error(`expected no parse error for a valid schema, got: ${doc.getElementById("parseError").textContent}`);
  }
  console.log("OK: no parse error for a valid schema");

  const tableSelect = doc.getElementById("tableSelect");
  if (tableSelect.children.length === 0) throw new Error("table select wasn't populated");
  tableSelect.value = "orders";
  tableSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => doc.getElementById("mappingBody").children.length > 0);
  const mappingRows = doc.getElementById("mappingBody").children.length;
  console.log(`OK: orders table rendered ${mappingRows} real column rows`);

  const outputBefore = doc.getElementById("mappingOutput").textContent;
  const parsedBefore = JSON.parse(outputBefore);
  if (!parsedBefore.orders || parsedBefore.orders.targetModel !== "Order") {
    throw new Error(`expected orders to auto-match the real "Order" model, got targetModel: ${parsedBefore.orders && parsedBefore.orders.targetModel}`);
  }
  if (parsedBefore.orders.columns.id.confidence <= 0) {
    throw new Error("expected a real, non-zero confidence for orders.id matching Order.id");
  }
  console.log("OK: orders auto-matched to the real Order model with real non-zero confidence on id");

  const exportedTableCount = Object.keys(parsedBefore).length;
  if (exportedTableCount < 15) {
    throw new Error(`expected the full mapping to cover every canonical table (~21), got only ${exportedTableCount}`);
  }
  console.log(`OK: full mapping.json covers ${exportedTableCount} canonical tables, not just the 6 shown for editing`);

  const firstSelect = doc.getElementById("mappingBody").querySelector("select");
  // Skip the empty "(none -- skip this column)" placeholder -- picking it
  // clears the override (reverting to the real auto-match) by design, not
  // a literal empty-string targetColumn, so it's not a meaningful "other"
  // option to override *to* for this test.
  const otherOption = [...firstSelect.options].find((o) => o.value !== firstSelect.value && o.value !== "");
  if (!otherOption) throw new Error("no real (non-placeholder) alternative option available to test a manual override with");
  firstSelect.value = otherOption.value;
  firstSelect.dispatchEvent(new window.Event("change", { bubbles: true }));

  const firstColumnName = Object.keys(parsedBefore.orders.columns)[0];
  await waitFor(() => {
    const current = JSON.parse(doc.getElementById("mappingOutput").textContent);
    return current.orders.columns[firstColumnName].targetColumn === otherOption.value;
  });

  const outputAfter = JSON.parse(doc.getElementById("mappingOutput").textContent);
  if (outputAfter.orders.columns[firstColumnName].confidence !== 1) {
    throw new Error("expected a manual override to have confidence 1");
  }
  console.log("OK: manually overriding %s's target actually changed the exported mapping, with confidence 1", firstColumnName);

  // Deliberately implausible override so clearing it later is unambiguous
  // -- "total" mapped to "status" would never be a real auto-match (both
  // are real Order fields, so the dropdown offers it, but no sane scoring
  // would pick "status" for "total"); after switching to User (which has
  // no "status" field at all), a still-present "status" value can only
  // mean the override was never cleared.
  const totalSelect = [...doc.getElementById("mappingBody").querySelectorAll("select")].find(
    (sel) => sel.closest("tr").firstChild.textContent === "total"
  );
  const statusOption = [...totalSelect.options].find((o) => o.value === "status");
  if (!statusOption) throw new Error('expected a "status" option on the total column\'s dropdown (a real field on the Order model)');
  totalSelect.value = "status";
  totalSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => JSON.parse(doc.getElementById("mappingOutput").textContent).orders.columns.total.targetColumn === "status");
  console.log('OK: deliberately overrode total -> "status" (implausible on purpose, to make clearing it unambiguous later)');

  // Target-model override: switch orders to (deliberately, wrongly) map
  // against the User model instead of Order, and confirm the whole
  // table's column mapping actually recomputes against User's real
  // fields -- not just a label change with stale column data left over.
  const modelSelect = doc.getElementById("targetModelRow").querySelector("select");
  modelSelect.value = "User";
  modelSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => JSON.parse(doc.getElementById("mappingOutput").textContent).orders.targetModel === "User");
  const afterModelSwitch = JSON.parse(doc.getElementById("mappingOutput").textContent);
  const idMapping = afterModelSwitch.orders.columns.id;
  if (idMapping.targetColumn !== "id") {
    throw new Error(`expected orders.id matched against User's real fields (which also has an "id" field), got targetColumn "${idMapping.targetColumn}"`);
  }
  // The implausible "total" -> "status" override was picked against the
  // OLD model's field list -- a model switch must clear it, not silently
  // keep misrepresenting "status" as still the right target under User
  // (which has no "status" field at all).
  if (afterModelSwitch.orders.columns.total.targetColumn === "status") {
    throw new Error('expected the implausible total -> "status" override to be cleared after switching target models, but it\'s still "status"');
  }
  console.log("OK: switching the target model actually recomputes column matches against the new model's real fields, and clears stale column overrides");

  doc.getElementById("downloadBtn").click();
  if (!lastDownloadedBlobText) throw new Error("download button didn't produce a blob");
  const downloaded = JSON.parse(lastDownloadedBlobText);
  const currentDisplayed = JSON.parse(doc.getElementById("mappingOutput").textContent);
  if (JSON.stringify(downloaded.orders) !== JSON.stringify(currentDisplayed.orders)) {
    throw new Error("downloaded mapping.json doesn't match what's currently displayed (targetModel=User, total's cleared override)");
  }
  if (downloaded.orders.targetModel !== "User") {
    throw new Error(`expected the download to reflect the model-switch override (targetModel: "User"), got "${downloaded.orders.targetModel}"`);
  }
  console.log("OK: download button produces the real, current (edited) mapping.json, matching what's on screen");

  textarea.value = "this is not a prisma schema at all";
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  await waitFor(() => doc.getElementById("parseError").textContent.trim() !== "");
  console.log("OK: non-Prisma input shows a clear message:", doc.getElementById("parseError").textContent.trim());

  console.log("\nAll mapping designer smoke tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
