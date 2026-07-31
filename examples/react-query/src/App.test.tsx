// src/App.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { hooks } from "./lib/queryHooks";

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

describe("App", () => {
  it("loads products and paginates", async () => {
    renderApp();

    await waitFor(() => expect(screen.getByTestId("products-list").children.length).toBe(5));
    const firstPageNames = Array.from(screen.getByTestId("products-list").children).map((li) => li.textContent);

    fireEvent.click(screen.getByTestId("next-page"));

    await waitFor(() => {
      const secondPageNames = Array.from(screen.getByTestId("products-list").children).map((li) => li.textContent);
      expect(secondPageNames).not.toEqual(firstPageNames);
    });
  });

  it("caches a previously visited page -- no new fetch going back to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderApp();

    await waitFor(() => expect(screen.getByTestId("products-list").children.length).toBe(5));
    const callsAfterPage1 = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/products")).length;

    fireEvent.click(screen.getByTestId("next-page"));
    await waitFor(() => expect(screen.getByTestId("products-fetching")).toBeUndefined);

    fireEvent.click(screen.getByTestId("prev-page"));
    // Give React Query a moment; if it were re-fetching page 1, this would
    // show a fetching indicator and issue another network call.
    await new Promise((r) => setTimeout(r, 50));

    const callsAfterReturningToPage1 = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/products")
    ).length;

    // Exactly two unique page fetches (page 1, page 2) -- returning to page 1
    // was served from cache, not a third network call.
    expect(callsAfterReturningToPage1).toBe(callsAfterPage1 + 1);
    fetchSpy.mockRestore();
  });

  it("optimistically marks an order cancelled before the server responds", async () => {
    renderApp();

    await waitFor(() => expect(screen.getByTestId("orders-list").children.length).toBeGreaterThan(0));

    const firstRow = screen.getAllByTestId("order-row")[0];
    fireEvent.click(firstRow.querySelector('[data-testid="cancel-button"]')!);

    // The mocked handler has an 800ms delay before it actually resolves --
    // this assertion running well before that proves the UI update is
    // optimistic (from onMutate), not waiting on the network response.
    await waitFor(
      () => {
        expect(firstRow.querySelector('[data-testid="order-status"]')).toHaveTextContent("cancelled");
      },
      { timeout: 300 }
    );
  });

  it("background refetching keeps a query updated on an interval with no user action", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Harness() {
      const { dataUpdatedAt } = hooks.orders.useList(
        { filters: { status: "processing" }, pageSize: 5 },
        { refetchInterval: 100 }
      );
      return <span data-testid="updated-at">{dataUpdatedAt}</span>;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/orders")).length;
      expect(calls).toBeGreaterThanOrEqual(1);
    });

    const firstUpdatedAt = screen.getByTestId("updated-at").textContent;

    await waitFor(
      () => {
        const laterUpdatedAt = screen.getByTestId("updated-at").textContent;
        expect(laterUpdatedAt).not.toBe(firstUpdatedAt);
      },
      { timeout: 2000 }
    );

    fetchSpy.mockRestore();
  });
});
