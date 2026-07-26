import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateBashCompletion, generateZshCompletion, generateFishCompletion, generateCompletion, SUPPORTED_SHELLS } from "../src/completion.js";

// execSync always runs through `/bin/sh -c`, so when a shell binary isn't
// installed, /bin/sh itself starts fine and just reports "not found" with
// exit status 127 -- there's no ENOENT, since spawning /bin/sh succeeded.
// Check availability up front instead of trying to sniff it out of a caught
// exec error, and skip via vitest's own skipIf rather than an early return
// buried in the test body.
function isShellAvailable(shell: string): boolean {
  try {
    execSync(`command -v ${shell}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasZsh = isShellAvailable("zsh");
const hasFish = isShellAvailable("fish");

const commands = [
  { name: "generate", flags: ["--users", "--seed", "--format", "--output"] },
  { name: "score", flags: ["--input", "--format"] },
  { name: "scenarios", flags: [] },
];

describe("generateCompletion", () => {
  it("dispatches to the right generator per shell", () => {
    expect(generateCompletion("bash", "my-eco-gen", commands)).toBe(generateBashCompletion("my-eco-gen", commands));
    expect(generateCompletion("zsh", "my-eco-gen", commands)).toBe(generateZshCompletion("my-eco-gen", commands));
    expect(generateCompletion("fish", "my-eco-gen", commands)).toBe(generateFishCompletion("my-eco-gen", commands));
  });

  it("SUPPORTED_SHELLS is exactly bash/zsh/fish", () => {
    expect(SUPPORTED_SHELLS).toEqual(["bash", "zsh", "fish"]);
  });
});

describe("generateBashCompletion", () => {
  const script = generateBashCompletion("my-eco-gen", commands);
  const scriptPath = path.join(tmpdir(), `eco-completion-test-${Date.now()}.bash`);
  writeFileSync(scriptPath, script, "utf-8");

  it("is valid bash syntax", () => {
    expect(() => execSync(`bash -n ${scriptPath}`)).not.toThrow();
  });

  it("actually completes a real subcommand name when sourced and invoked, matching commander's real command list", () => {
    const output = execSync(
      `bash -c 'source ${scriptPath}; COMP_WORDS=(my-eco-gen "sc"); COMP_CWORD=1; _my_eco_gen_completions; echo "${"$"}{COMPREPLY[@]}"'`
    )
      .toString()
      .trim();
    expect(output.split(" ").sort()).toEqual(["scenarios", "score"]);
  });

  it("actually completes a real per-command flag, not another command's flag", () => {
    const output = execSync(
      `bash -c 'source ${scriptPath}; COMP_WORDS=(my-eco-gen generate "--fo"); COMP_CWORD=2; _my_eco_gen_completions; echo "${"$"}{COMPREPLY[@]}"'`
    )
      .toString()
      .trim();
    expect(output).toBe("--format");
  });

  it("offers no flags for a command with none (scenarios)", () => {
    const output = execSync(
      `bash -c 'source ${scriptPath}; COMP_WORDS=(my-eco-gen scenarios ""); COMP_CWORD=2; _my_eco_gen_completions; echo "${"$"}{COMPREPLY[@]}"'`
    )
      .toString()
      .trim();
    expect(output).toBe("");
  });
});

describe("generateZshCompletion", () => {
  it.skipIf(!hasZsh)("is valid zsh syntax", () => {
    const script = generateZshCompletion("my-eco-gen", commands);
    const scriptPath = path.join(tmpdir(), `eco-completion-test-${Date.now()}.zsh`);
    writeFileSync(scriptPath, script, "utf-8");
    expect(() => execSync(`zsh -n ${scriptPath}`)).not.toThrow();
  });

  it("includes every real command name and its real flags in the generated case statement", () => {
    const script = generateZshCompletion("my-eco-gen", commands);
    expect(script).toContain("generate");
    expect(script).toContain("--format");
    expect(script).toContain("score");
  });
});

describe("generateFishCompletion", () => {
  const script = generateFishCompletion("my-eco-gen", commands);
  const scriptPath = path.join(tmpdir(), `eco-completion-test-${Date.now()}.fish`);
  writeFileSync(scriptPath, script, "utf-8");

  it.skipIf(!hasFish)("is valid fish syntax", () => {
    expect(() => execSync(`fish -n ${scriptPath}`)).not.toThrow();
  });

  it.skipIf(!hasFish)("actually completes a real subcommand name via fish's non-interactive `complete -C`", () => {
    const output = execSync(`fish -c "source ${scriptPath}; complete -C 'my-eco-gen sc'"`).toString().trim();
    expect(output.split("\n").sort()).toEqual(["scenarios", "score"]);
  });
});
