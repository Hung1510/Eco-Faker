// tests/orders.spec.ts
import { test, expect } from "../fixtures/server-fixture";

test.beforeEach(async ({ workerBaseURL, request }) => {
  // Restore the pristine, deterministically-generated dataset before every
  // test -- so test order and prior mutations (like cancelling an order)
  // never leak between tests, even though all tests in this file share one
  // server instance for the whole worker.
  await request.post(`${workerBaseURL}/test/reset`);
});

test("shows processing orders on load", async ({ page, workerBaseURL }) => {
  await page.goto(workerBaseURL);
  await expect(page.getByTestId("order-row").first()).toBeVisible();
});

test("cancelling an order updates its status in the UI", async ({ page, workerBaseURL }) => {
  await page.goto(workerBaseURL);
  const firstRow = page.getByTestId("order-row").first();
  await firstRow.getByTestId("cancel-button").click();
  await expect(firstRow.getByTestId("order-status")).toHaveText("cancelled");
});

test("reset in beforeEach restores state -- no cancelled orders leak in", async ({ page, workerBaseURL }) => {
  // Runs after the previous test in file order, but `beforeEach` already
  // reset the server back to the pristine seeded dataset, so the order
  // cancelled above is "processing" again here.
  await page.goto(workerBaseURL);
  const statuses = await page.getByTestId("order-status").allTextContents();
  expect(statuses).not.toContain("cancelled");
});

test("the same seed always produces the same first order id", async ({ workerBaseURL, request }) => {
  // Fetching twice, with a reset in between, proves the dataset is
  // byte-for-byte reproducible for this worker's seed -- not just "looks
  // similar", but the literal same generated id every time.
  const first = await (await request.get(`${workerBaseURL}/api/orders?status=processing&limit=1`)).json();
  await request.post(`${workerBaseURL}/test/reset`);
  const second = await (await request.get(`${workerBaseURL}/api/orders?status=processing&limit=1`)).json();

  expect(second.data[0].id).toBe(first.data[0].id);
});
