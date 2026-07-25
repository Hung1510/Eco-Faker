import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";

// Attach just enough DOM globals for @testing-library/react's renderHook to
// work, without switching vitest to the "jsdom" test environment -- that
// environment replaces globalThis.fetch with its own implementation, which
// MSW's node interceptor (patched onto Node's real global fetch/undici
// dispatcher below via server.listen()) never sees. Keeping the default
// "node" environment means fetch behaves exactly as it does in msw.test.ts.
const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as any).HTMLElement = dom.window.HTMLElement;

const { renderHook, waitFor } = await import("@testing-library/react");
const React = (await import("react")).default;
const { generate } = await import("../src/generator.js");
const { toMswHandlers } = await import("../src/msw.js");
const { createEcoFakerQueryHooks } = await import("../src/react-query.js");

const dataset = generate({ seed: 7, scaleFactor: 60 });
const server = setupServer(...toMswHandlers(dataset));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(...toMswHandlers(dataset)));
afterAll(() => server.close());

const hooks = createEcoFakerQueryHooks({ baseUrl: "http://localhost/api" });

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe("React Query adapter (createEcoFakerQueryHooks)", () => {
  it("useList fetches a paginated page, same shape as serve's response", async () => {
    const { result } = renderHook(() => hooks.orders.useList({ pageSize: 5 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.length).toBeLessThanOrEqual(5);
    expect(result.current.data?.pagination.pageSize).toBe(5);
  });

  it("useList applies filters exactly like serve's query params", async () => {
    const { result } = renderHook(() => hooks.orders.useList({ filters: { status: "delivered" }, pageSize: 10 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.every((o: any) => o.status === "delivered")).toBe(true);
  });

  it("useById fetches a single record", async () => {
    const target = dataset.orders[0];
    const { result } = renderHook(() => hooks.orders.useById(target.id), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((result.current.data as any)?.id).toBe(target.id);
  });

  it("useById stays disabled (no fetch) while id is undefined", async () => {
    const { result } = renderHook(() => hooks.orders.useById(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("useById surfaces a 404 as an error, matching serve's response", async () => {
    const { result } = renderHook(() => hooks.orders.useById("does-not-exist"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("404");
  });

  it("covers every table in TABLE_ROUTES, camelCased, with zero dedicated wiring", async () => {
    expect(Object.keys(hooks)).toContain("supportTickets");
    expect(Object.keys(hooks)).toContain("abandonedCheckouts");
    const { result } = renderHook(() => hooks.supportTickets.useList({ pageSize: 3 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pagination.pageSize).toBe(3);
  });
});
