import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const cliPath = path.resolve(__dirname, "../src/cli.ts");

function runCli(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", cliPath, ...args], { encoding: "utf-8", input: "" });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), status: e.status ?? 1 };
  }
}

describe("my-eco-gen docs", () => {
  it("resolves a real topic to a real README anchor and prints the URL", () => {
    const result = runCli(["docs", "score"]);
    expect(result.stdout).toContain("https://github.com/Hung1510/Eco-Faker#data-quality--realism-score-score");
  });

  it("resolves 'mutate' to the Mutation testing section specifically, not Contract testing", () => {
    const result = runCli(["docs", "mutate"]);
    expect(result.stdout).toContain("#mutation-testing-test---mutate");
  });

  it("with no topic, prints the bare README URL", () => {
    const result = runCli(["docs"]);
    expect(result.stdout).toContain("https://github.com/Hung1510/Eco-Faker#readme");
  });

  it("fails with a list of real available sections for an unmatched topic", () => {
    const result = runCli(["docs", "this-topic-genuinely-does-not-exist"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("No README section matches");
    expect(result.stdout).toContain("Features");
    expect(result.stdout).toContain("Roadmap");
  });
});

describe("my-eco-gen completion", () => {
  it("prints a real bash completion script referencing real subcommand names", () => {
    const result = runCli(["completion", "bash"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("_my_eco_gen_completions");
    expect(result.stdout).toContain("generate");
    expect(result.stdout).toContain("score");
    expect(result.stdout).toContain("completion");
  });

  it("prints a real zsh completion script", () => {
    const result = runCli(["completion", "zsh"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("#compdef my-eco-gen");
  });

  it("prints a real fish completion script", () => {
    const result = runCli(["completion", "fish"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("complete -c my-eco-gen");
  });

  it("the generated bash script's per-command flags actually match a real command's real options (score: --input, --format)", () => {
    const result = runCli(["completion", "bash"]);
    const scoreLine = result.stdout.split("\n").find((line) => line.trim().startsWith("score)"));
    expect(scoreLine).toContain("--input");
    expect(scoreLine).toContain("--format");
  });

  it("rejects an unknown shell", () => {
    const result = runCli(["completion", "powershell"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Unknown shell");
  });
}, 30000);
