import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type OutputFormat = "json" | "sql" | "csv";

export interface GenerateOptions {
  users: number;
  scenario?: string; // one of the named presets, or undefined for default config
  format: OutputFormat;
  outputPath: string; // relative or absolute path to write to
}

export interface ScaffoldOptions {
  target: "next" | "msw";
  seed?: number;
  force?: boolean;
}

export interface CliInvocation {
  command: string;
  args: string[];
}

/**
 * Whether to shell out to a globally-installed `my-eco-gen` or fall back to
 * `npx eco-faker` -- checked once, passed in rather than probed inside the
 * pure builder functions below, so those stay pure and testable without
 * needing a real filesystem/PATH to look at.
 */
export function resolveCliCommand(hasGlobalCli: boolean): { command: string; baseArgs: string[] } {
  return hasGlobalCli ? { command: "my-eco-gen", baseArgs: [] } : { command: "npx", baseArgs: ["--yes", "eco-faker"] };
}

/**
 * Builds the real `generate` invocation from validated options -- kept
 * pure (no `vscode` API, no filesystem access) specifically so this can be
 * unit-tested with plain Node, not requiring a real Extension Host, which
 * this sandbox has no way to run.
 */
export function buildGenerateInvocation(options: GenerateOptions, cli: { command: string; baseArgs: string[] }): CliInvocation {
  const args = [...cli.baseArgs, "generate", "--users", String(options.users), "--format", options.format, "--output", options.outputPath];
  if (options.scenario) args.push("--scenario", options.scenario);
  return { command: cli.command, args };
}

export function buildScaffoldInvocation(options: ScaffoldOptions, cli: { command: string; baseArgs: string[] }): CliInvocation {
  const args = [...cli.baseArgs, "init", options.target];
  if (options.seed !== undefined) args.push("--seed", String(options.seed));
  if (options.force) args.push("--force");
  return { command: cli.command, args };
}

/** Resolves a user-provided output path against a workspace folder, same way any other CLI-invoking tool would, so a relative path like "./eco-data.json" lands inside the project instead of wherever the extension host process happens to be running from. */
export function resolveOutputPath(workspaceRoot: string, userInput: string): string {
  return path.isAbsolute(userInput) ? userInput : path.join(workspaceRoot, userInput);
}

export interface CliRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** The one side-effecting function in this module -- everything above it is pure and unit-tested directly; this is exercised by actually spawning the real CLI in a Node-only integration test, without ever touching the `vscode` module. */
export function runCli(invocation: CliInvocation, cwd: string): Promise<CliRunResult> {
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, { cwd, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (exitCode) => resolve({ ok: exitCode === 0, stdout, stderr, exitCode }));
    child.on("error", (err) => resolve({ ok: false, stdout, stderr: stderr + err.message, exitCode: null }));
  });
}

/** Best-effort, synchronous-enough check for whether `my-eco-gen` is on PATH -- used once at command-invocation time to decide between it and `npx eco-faker`, not cached across the extension's lifetime (a user could install it mid-session). */
export function looksLikeGloballyInstalled(pathDirs: string[], binName = "my-eco-gen"): boolean {
  const candidates = process.platform === "win32" ? [binName, `${binName}.cmd`, `${binName}.exe`] : [binName];
  return pathDirs.some((dir) => candidates.some((name) => existsSync(path.join(dir, name))));
}
