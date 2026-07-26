import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // vscode-extension/ is a fully standalone package (own package.json,
    // own test runner via `node --test`, not vitest) -- without this
    // exclude, vitest's default discovery glob picks up its *compiled*
    // node:test-based test files too (dist-test/tests/*.test.js) and
    // fails on them with "No test suite found", since they use a
    // different test API entirely. Real failure, caught by running the
    // full root suite after adding the extension, not assumed safe.
    // Spread vitest's own default excludes rather than replacing them --
    // setting `exclude` at all overrides the defaults entirely otherwise.
    exclude: [...configDefaults.exclude, "vscode-extension/**"],
  },
});
