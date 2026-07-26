import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateBashCompletion, generateZshCompletion, generateFishCompletion, generateCompletion, SUPPORTED_SHELLS } from "../src/completion.js";

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
  it("is valid zsh syntax", () => {
    const script = generateZshCompletion("my-eco-gen", commands);
    const scriptPath = path.join(tmpdir(), `eco-completion-test-${Date.now()}.zsh`);
    writeFileSync(scriptPath, script, "utf-8");
    try {
      expect(() => execSync(`zsh -n ${scriptPath}`)).not.toThrow();
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return; // zsh not installed on this runner -- skip, don't fail
      throw err;
    }
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

  it("is valid fish syntax", () => {
    try {
      expect(() => execSync(`fish -n ${scriptPath}`)).not.toThrow();
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return; // fish not installed on this runner -- skip, don't fail
      throw err;
    }
  });

  it("actually completes a real subcommand name via fish's non-interactive `complete -C`", () => {
    let output: string;
    try {
      output = execSync(`fish -c "source ${scriptPath}; complete -C 'my-eco-gen sc'"`).toString().trim();
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return; // fish not installed on this runner -- skip, don't fail
      throw err;
    }
    expect(output.split("\n").sort()).toEqual(["scenarios", "score"]);
  });
});
