// src/test/setup.ts
//
// Explicit expect.extend() + local module augmentation, rather than the
// simpler `import "@testing-library/jest-dom/vitest"`. In a hoisted
// monorepo where a sibling workspace pins a different vitest major
// version, jest-dom's own ambient-augmentation file can resolve "vitest"
// against the wrong (hoisted) copy, silently failing to type-augment the
// `vitest` your test files actually import. Augmenting from right here,
// against this file's own "vitest" import, sidesteps that regardless of
// hoisting layout.
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { server } from "../mocks/server";

expect.extend(matchers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
