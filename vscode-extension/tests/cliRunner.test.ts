import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildGenerateInvocation,
  buildScaffoldInvocation,
  resolveCliCommand,
  resolveOutputPath,
  looksLikeGloballyInstalled,
} from "../src/cliRunner.js";

describe("resolveCliCommand", () => {
  it("uses my-eco-gen directly when globally installed", () => {
    assert.deepEqual(resolveCliCommand(true), { command: "my-eco-gen", baseArgs: [] });
  });

  it("falls back to npx eco-faker when not globally installed", () => {
    assert.deepEqual(resolveCliCommand(false), { command: "npx", baseArgs: ["--yes", "eco-faker"] });
  });
});

describe("buildGenerateInvocation", () => {
  it("builds the exact real generate command for a globally-installed CLI", () => {
    const invocation = buildGenerateInvocation(
      { users: 100, format: "sql", outputPath: "/workspace/eco-data.sql" },
      { command: "my-eco-gen", baseArgs: [] }
    );
    assert.equal(invocation.command, "my-eco-gen");
    assert.deepEqual(invocation.args, ["generate", "--users", "100", "--format", "sql", "--output", "/workspace/eco-data.sql"]);
  });

  it("includes --scenario only when one is given", () => {
    const withScenario = buildGenerateInvocation(
      { users: 50, scenario: "black-friday", format: "json", outputPath: "./eco-data.json" },
      { command: "my-eco-gen", baseArgs: [] }
    );
    assert.ok(withScenario.args.includes("--scenario"));
    assert.ok(withScenario.args.includes("black-friday"));

    const withoutScenario = buildGenerateInvocation(
      { users: 50, format: "json", outputPath: "./eco-data.json" },
      { command: "my-eco-gen", baseArgs: [] }
    );
    assert.ok(!withoutScenario.args.includes("--scenario"));
  });

  it("prepends baseArgs for the npx fallback, so the built command is `npx --yes eco-faker generate ...`", () => {
    const invocation = buildGenerateInvocation(
      { users: 10, format: "csv", outputPath: "./eco-data.csv" },
      { command: "npx", baseArgs: ["--yes", "eco-faker"] }
    );
    assert.equal(invocation.command, "npx");
    assert.deepEqual(invocation.args.slice(0, 3), ["--yes", "eco-faker", "generate"]);
  });
});

describe("buildScaffoldInvocation", () => {
  it("builds `init next` / `init msw` correctly", () => {
    const next = buildScaffoldInvocation({ target: "next" }, { command: "my-eco-gen", baseArgs: [] });
    assert.deepEqual(next.args, ["init", "next"]);

    const msw = buildScaffoldInvocation({ target: "msw" }, { command: "my-eco-gen", baseArgs: [] });
    assert.deepEqual(msw.args, ["init", "msw"]);
  });

  it("includes --seed and --force only when given", () => {
    const invocation = buildScaffoldInvocation({ target: "next", seed: 42, force: true }, { command: "my-eco-gen", baseArgs: [] });
    assert.deepEqual(invocation.args, ["init", "next", "--seed", "42", "--force"]);

    const bare = buildScaffoldInvocation({ target: "next" }, { command: "my-eco-gen", baseArgs: [] });
    assert.equal(bare.args.includes("--seed"), false);
    assert.equal(bare.args.includes("--force"), false);
  });
});

describe("resolveOutputPath", () => {
  it("joins a relative path onto the workspace root", () => {
    assert.equal(resolveOutputPath("/workspace/project", "./eco-data.json"), path.join("/workspace/project", "./eco-data.json"));
  });

  it("leaves an absolute path untouched", () => {
    const absolute = process.platform === "win32" ? "C:\\Users\\me\\eco-data.json" : "/tmp/eco-data.json";
    assert.equal(resolveOutputPath("/workspace/project", absolute), absolute);
  });
});

describe("looksLikeGloballyInstalled", () => {
  it("returns false when no PATH directory contains the binary", () => {
    assert.equal(looksLikeGloballyInstalled(["/definitely/not/a/real/path/xyz"]), false);
  });

  it("returns true when a PATH directory really does contain the binary", () => {
    // Use this very test file's own directory as a stand-in "PATH entry"
    // containing a file with the expected name -- a real filesystem
    // check, not a mocked fs module.
    assert.equal(looksLikeGloballyInstalled([__dirname], path.basename(__filename)), true);
  });
});
