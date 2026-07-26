# eco-faker for VS Code

Generate a relationally-consistent fake e-commerce dataset, or scaffold a Next.js/MSW integration, without leaving the editor -- a graphical front end over the [eco-faker](https://www.npmjs.com/package/eco-faker) CLI.

## Commands

Open the Command Palette (`Cmd/Ctrl+Shift+P`) and run:

- **`eco-faker: Generate Dataset`** -- prompts for user count, an optional scenario preset, output format (JSON/SQL/CSV), and an output path, then runs the real `generate` command and offers to open the written file.
- **`eco-faker: Scaffold Next.js Integration (init next)`** -- runs `init next`, writing a seed script and a Next.js API route into the open workspace.
- **`eco-faker: Scaffold MSW Integration (init msw)`** -- runs `init msw`, writing MSW handlers + browser/server setup into the open workspace.

All three shell out to the real CLI (`my-eco-gen` if it's on your `PATH`, otherwise `npx eco-faker` automatically) -- this extension is a UI in front of the exact same commands documented in the [main README](../README.md#cli), not a reimplementation of any of eco-faker's generation logic. Output (stdout/stderr from the underlying CLI call) is available in the "eco-faker" output channel for any failure.

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

**What's been verified, and what hasn't.** `cliRunner.ts` -- everything that builds command-line invocations and resolves paths -- is pure and unit-tested directly (`tests/cliRunner.test.ts`), plus a real integration test (`tests/cliRunner.integration.test.ts`) that actually spawns the real compiled CLI end-to-end: generates a real dataset and confirms the file and its row count, runs a real `init msw` scaffold and confirms the real files it writes, and confirms both a bad-flag failure and a nonexistent-command failure are reported as `{ ok: false }` results rather than a hang or a thrown exception. `esbuild` bundling and `vsce package` were both run for real, producing an actual installable `.vsix`, with `vscode` confirmed correctly externalized (the bundle fails to `require("vscode")` outside a real Extension Host, exactly as it should). **What's not been verified: `extension.ts` itself, running inside a real VS Code Extension Host** -- this environment has no way to launch one (`@vscode/test-electron` needs to download the actual VS Code binary from `update.code.visualstudio.com`, which isn't reachable here). The command-registration/QuickPick/progress-notification flow in `extension.ts` is a thin, deliberately simple layer on top of the tested `cliRunner.ts` functions, but it hasn't been clicked through in a real editor window. If something in that UI flow doesn't behave as expected, that's the part to look at first.

## Scope

First slice, matching what was scoped for it: generate + scaffold commands only. **Not built:** a table viewer or relationship explorer inside the editor (the CLI's own `visualize`/static browser demo already cover a version of this outside VS Code) -- a natural next step, not attempted here.
