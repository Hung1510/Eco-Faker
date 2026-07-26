# eco-faker for VS Code

Generate a relationally-consistent fake e-commerce dataset, or scaffold a Next.js/MSW integration, without leaving the editor -- a graphical front end over the [eco-faker](https://www.npmjs.com/package/eco-faker) CLI.

## Commands

Open the Command Palette (`Cmd/Ctrl+Shift+P`) and run:

- **`eco-faker: Generate Dataset`** -- prompts for user count, an optional scenario preset, output format (JSON/SQL/CSV), and an output path, then runs the real `generate` command. On a JSON generation, offers "View tables" to jump straight into the table viewer below.
- **`eco-faker: View Dataset Tables`** -- pick any `dataset.json` (from `generate --format json`) and browse it in a webview: switch tables, search across all columns, click a column header to sort, page through results. Entirely client-side once the file is loaded -- no server, no round-trips back to the extension for each interaction.
- **`eco-faker: Scaffold Next.js Integration (init next)`** -- runs `init next`, writing a seed script and a Next.js API route into the open workspace.
- **`eco-faker: Scaffold MSW Integration (init msw)`** -- runs `init msw`, writing MSW handlers + browser/server setup into the open workspace.

The three CLI-invoking commands shell out to the real CLI (`my-eco-gen` if it's on your `PATH`, otherwise `npx eco-faker` automatically) -- this extension is a UI in front of the exact same commands documented in the [main README](../README.md#cli), not a reimplementation of any of eco-faker's generation logic. Output (stdout/stderr from the underlying CLI call) is available in the "eco-faker" output channel for any failure.

## Requirements

A workspace folder open (there's nowhere to write the generated file/scaffold otherwise). Node.js -- either `eco-faker` installed globally, or nothing at all (falls back to `npx eco-faker`, which downloads it on first use).

## Development

```bash
npm install
npm run compile   # type-check
npm test          # runs the real CLI end-to-end via node:test -- no `vscode` module involved
npm run build     # bundles src/extension.ts -> dist/extension.js with esbuild (vscode externalized)
npm run package   # produces a real, installable .vsix via @vscode/vsce
```

**What's been verified, and what hasn't.** `cliRunner.ts` -- everything that builds command-line invocations and resolves paths -- is pure and unit-tested directly (`tests/cliRunner.test.ts`), plus a real integration test (`tests/cliRunner.integration.test.ts`) that actually spawns the real compiled CLI end-to-end: generates a real dataset and confirms the file and its row count, runs a real `init msw` scaffold and confirms the real files it writes, and confirms both a bad-flag failure and a nonexistent-command failure are reported as `{ ok: false }` results rather than a hang or a thrown exception. The table viewer's entire client-side behavior (`src/tableViewer.ts`) is a single template string embedded once into the generated HTML -- and that exact same embedded script is what `tests/tableViewer.test.ts` actually loads and executes via [jsdom](https://github.com/jsdom/jsdom) (the same technique this project's root repo already uses for its own static-demo smoke test): table switching, search filtering, column-click sorting, and pagination are all genuinely exercised against real DOM events, not asserted from reading the code. `esbuild` bundling and `vsce package` were both run for real, producing an actual installable `.vsix`, with `vscode` confirmed correctly externalized (the bundle fails to `require("vscode")` outside a real Extension Host, exactly as it should). **What's not been verified: `extension.ts` itself, running inside a real VS Code Extension Host** -- this environment has no way to launch one (`@vscode/test-electron` needs to download the actual VS Code binary from `update.code.visualstudio.com`, which isn't reachable here). The command-registration/QuickPick/progress-notification/webview-creation flow in `extension.ts` is a thin, deliberately simple layer on top of the tested `cliRunner.ts`/`tableViewer.ts` functions, but it hasn't been clicked through in a real editor window. If something in that UI flow doesn't behave as expected, that's the part to look at first.

## Scope

First slice: generate, view, and scaffold commands. The table viewer embeds the entire dataset client-side, which is fine for the modest, hundreds-to-low-thousands-of-rows-per-table datasets this tool is meant for local dev use with -- a dataset generated at a much larger `scaleFactor` means a correspondingly large embedded JSON blob, not something this first slice tries to handle. A Miller-columns relationship drill-down (User → Orders → Shipment/Returns, matching the CLI's own `web-static/explorer.html`) is a natural next step on top of this, not attempted here.
