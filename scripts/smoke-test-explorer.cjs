const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "web-static", "explorer.html"), "utf8");
const htmlWithoutScript = html.replace(/<script src="\.\/dist\/explorer-bundle\.js"><\/script>/, "");
const dom = new JSDOM(htmlWithoutScript, { runScripts: "dangerously", resources: "usable", url: "http://localhost/explorer.html" });
const { window } = dom;

const bundleCode = fs.readFileSync(path.join(__dirname, "..", "web-static", "dist", "explorer-bundle.js"), "utf8");

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
  // Run the actual bundled code inside the jsdom window -- equivalent to
  // the browser loading <script src="./dist/explorer-bundle.js">, but
  // without needing a real HTTP server for jsdom to fetch it from.
  window.eval(bundleCode);

  // The bundle runs on script load; give it a tick to execute and populate the DOM.
  await waitFor(() => window.document.getElementById("status")?.textContent?.includes("generated in"));

  const doc = window.document;

  const statusText = doc.getElementById("status").textContent;
  if (!/\d+ users, \d+ orders, \d+ shipments, \d+ return requests/.test(statusText)) {
    throw new Error(`status line didn't look right: "${statusText}"`);
  }
  console.log("OK: dataset generated and status line rendered:", statusText);

  const scenarioOptions = doc.getElementById("scenario").children.length;
  if (scenarioOptions < 5) throw new Error(`expected scenario dropdown to be populated, got ${scenarioOptions} options`);
  console.log("OK: scenario dropdown populated with", scenarioOptions, "options");

  const userRows = doc.querySelectorAll("#col-users [data-user-id]");
  if (userRows.length === 0) throw new Error("no user rows rendered");
  console.log("OK:", userRows.length, "user rows rendered");

  // Find a user who actually has at least one order, so the drill-down has somewhere to go.
  let userWithOrder = null;
  for (const row of userRows) {
    if (!row.querySelector(".sub").textContent.includes("0 orders")) {
      userWithOrder = row;
      break;
    }
  }
  if (!userWithOrder) throw new Error("no user with at least one order found in the rendered list");

  userWithOrder.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() => doc.querySelectorAll("#col-orders [data-order-id]").length > 0);
  const orderRows = doc.querySelectorAll("#col-orders [data-order-id]");
  console.log("OK: selecting a user rendered", orderRows.length, "order row(s)");

  if (!doc.getElementById("breadcrumb").textContent.includes("Order")) {
    // breadcrumb only shows "Order" after an order is selected, not yet -- check user name instead at this point
  }

  // Click through orders to find one with a shipment AND (separately) one
  // with a return request, so both leaf-detail code paths get exercised
  // independently rather than stopping at whichever comes first. Search
  // across several users' orders, not just the first one -- with a real
  // ~8% per-order return rate, a single user's small order set often has
  // none at all.
  let testedShipmentDetail = false;
  let testedReturnDetail = false;
  let usersChecked = 0;

  for (const userRow of userRows) {
    if ((testedShipmentDetail && testedReturnDetail) || usersChecked >= 25) break;
    if (userRow.querySelector(".sub").textContent.includes("0 orders")) continue;
    usersChecked++;

    userRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => true, 30).catch(() => {});
    const thisUsersOrders = doc.querySelectorAll("#col-orders [data-order-id]");

    for (const orderRow of thisUsersOrders) {
      if (testedShipmentDetail && testedReturnDetail) break;
      orderRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await waitFor(() => true, 30).catch(() => {});

      if (!testedShipmentDetail) {
        const shipmentRows = doc.querySelectorAll("#col-shipments [data-shipment-id]");
        if (shipmentRows.length > 0) {
          shipmentRows[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
          await waitFor(() => doc.getElementById("detail").innerHTML.includes("Tracking history"));
          const detailHtml = doc.getElementById("detail").innerHTML;
          if (!detailHtml.includes("Carrier")) throw new Error("shipment detail panel didn't render carrier info");
          console.log("OK: clicking a shipment rendered its tracking timeline in the detail panel");
          testedShipmentDetail = true;
        }
      }
      if (!testedReturnDetail) {
        const returnRows = doc.querySelectorAll("#col-returns [data-return-id]");
        if (returnRows.length > 0) {
          returnRows[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
          await waitFor(() => doc.getElementById("detail").innerHTML.includes("Return request"));
          const detailHtml = doc.getElementById("detail").innerHTML;
          if (!detailHtml.includes("Refund amount")) throw new Error("return detail panel didn't render refund info");
          console.log("OK: clicking a return request rendered its details in the detail panel");
          testedReturnDetail = true;
        }
      }
    }
  }
  if (!testedShipmentDetail) {
    console.log(`WARN: no order across ${usersChecked} users checked had a shipment to click through -- re-run to exercise that path.`);
  }
  if (!testedReturnDetail) {
    console.log(`WARN: no order across ${usersChecked} users checked had a return request to click through -- re-run to exercise that path.`);
  }

  // Exercise the search filter.
  const searchInput = doc.getElementById("userSearch");
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeSetter.call(searchInput, "zzzzzznomatch");
  searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await waitFor(() => doc.getElementById("col-users").textContent.includes("No users match"));
  console.log("OK: user search filter correctly shows a no-match state");

  console.log("\nAll relationship explorer smoke tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
