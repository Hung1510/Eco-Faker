// src/test/vitest-matchers.d.ts
//
// See setup.ts for why this is explicit rather than relying on
// `@testing-library/jest-dom/vitest`'s own ambient augmentation.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Assertion<T = unknown> extends TestingLibraryMatchers<T, void> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}
