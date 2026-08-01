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
    // Likewise, each project under examples/ has its own vitest setup
    // (own package.json, own jsdom/environment config, own handlers) and
    // is already run independently via the CI `examples` job -- without
    // this exclude, root vitest's discovery glob picks up
    // examples/*/src/*.test.tsx too and runs them under the *root's*
    // config (no jsdom), failing with "document is not defined". Real
    // failure, caught by running the full root suite after adding the
    // example projects, not assumed safe.
    exclude: [...configDefaults.exclude, "vscode-extension/**", "examples/**"],
  },
});
