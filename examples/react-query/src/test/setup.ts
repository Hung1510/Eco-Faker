// src/test/setup.ts
//
// Explicit expect.extend() + local module augmentation, rather than
// `import "@testing-library/jest-dom/vitest"`. In this repo's monorepo,
// vitest is pinned to a different major version at the root (for the
// root's own test suite) than this workspace uses, and jest-dom's own
// ambient-augmentation file can resolve "vitest" against the wrong
// (hoisted) copy. Augmenting from right here, against this file's own
// "vitest" import, sidesteps that regardless of hoisting layout.
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { server } from "../mocks/server";

expect.extend(matchers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
