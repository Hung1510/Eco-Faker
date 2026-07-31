// src/App.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";
import App from "./App";

describe("App", () => {
  it("renders products and orders from the mocked API", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("products-total")).toHaveTextContent("products in catalog");
    });

    const productsList = screen.getByTestId("products-list");
    expect(productsList.children.length).toBe(5);

    await waitFor(() => {
      expect(screen.getByTestId("orders-list")).toBeInTheDocument();
    });
    const ordersList = screen.getByTestId("orders-list");
    expect(ordersList.children.length).toBeGreaterThan(0);
  });

  it("switches order status filter and refetches", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByTestId("orders-list")).toBeInTheDocument());

    const select = screen.getByTestId("status-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "processing" } });

    await waitFor(() => {
      const items = Array.from(screen.getByTestId("orders-list").children);
      expect(items.length).toBeGreaterThan(0);
      items.forEach((item) => expect(item.textContent).toContain("processing"));
    });
  });

  it("handles a real server error via a one-off handler override", async () => {
    // Override just this test's /api/products response -- no need to touch
    // the component or the default handlers to exercise the error path.
    server.use(http.get("*/api/products", () => HttpResponse.json({ error: "boom" }, { status: 500 })));

    render(<App />);

    await waitFor(() => {
      // fetchProducts() throws on !res.ok; the component's .finally() still
      // clears the loading state, so "Loading products..." disappears.
      expect(screen.queryByTestId("products-loading")).not.toBeInTheDocument();
    });
  });
});
