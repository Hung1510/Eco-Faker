import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, buildGenerateInvocation, buildScaffoldInvocation } from "../src/cliRunner.js";

// __dirname here is the *compiled* location (dist-test/tests/), one level
// deeper than the source file (tests/) -- three levels up reaches the
// repo root (dist-test/tests -> dist-test -> vscode-extension -> repo
// root), not two. Got this wrong once before running it for real.
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");

describe("runCli (real spawn, no mocking)", () => {
  before(() => {
    if (!existsSync(cliPath)) {
      execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });
    }
  });

  it("actually generates a real dataset file via the same invocation shape the extension builds", async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "eco-faker-vscode-test-"));
    try {
      const invocation = buildGenerateInvocation(
        { users: 20, format: "json", outputPath: path.join(dir, "eco-data.json") },
        { command: "node", baseArgs: [cliPath] }
      );
      const result = await runCli(invocation, dir);
      assert.equal(result.ok, true, `expected success, got stderr: ${result.stderr}`);
      assert.ok(existsSync(path.join(dir, "eco-data.json")), "expected the CLI to have actually written the output file");

      const written = JSON.parse(readFileSync(path.join(dir, "eco-data.json"), "utf-8"));
      assert.equal(written.users.length, 20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("actually runs the init scaffold end-to-end and writes real files", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eco-faker-vscode-scaffold-test-"));
    try {
      const invocation = buildScaffoldInvocation({ target: "msw" }, { command: "node", baseArgs: [cliPath] });
      const result = await runCli(invocation, dir);
      assert.equal(result.ok, true, `expected success, got stderr: ${result.stderr}`);
      assert.ok(existsSync(path.join(dir, "mocks", "eco-handlers.ts")));
      assert.ok(result.stdout.includes("Wrote mocks/eco-handlers.ts"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a real failure (bad flag) with ok:false and a non-zero exit code, not a thrown exception", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eco-faker-vscode-fail-test-"));
    try {
      const result = await runCli({ command: "node", args: [cliPath, "generate", "--this-flag-does-not-exist"] }, dir);
      assert.equal(result.ok, false);
      assert.notEqual(result.exitCode, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a real spawn failure (nonexistent command) via the error path, not a hang or a throw", async () => {
    const result = await runCli({ command: "this-binary-does-not-exist-anywhere", args: [] }, process.cwd());
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, null);
  });
});
