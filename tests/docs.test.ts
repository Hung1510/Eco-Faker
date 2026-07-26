import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { githubSlug, parseReadmeHeadings, resolveDocsTopic, buildRepoUrl, buildDocsUrl } from "../src/docs.js";

describe("githubSlug", () => {
  it("matches real, manually-verified GitHub anchor slugs for headings with parens, backticks, and flag names", () => {
    expect(githubSlug("Contract testing (`test --contract`)")).toBe("contract-testing-test---contract");
    expect(githubSlug("Framework scaffolding (`init next` / `init msw`)")).toBe("framework-scaffolding-init-next--init-msw");
    expect(githubSlug("Mutation testing (`test --mutate`)")).toBe("mutation-testing-test---mutate");
    expect(githubSlug("Data quality / realism score (`score`)")).toBe("data-quality--realism-score-score");
  });

  it("lowercases and replaces plain spaces with single hyphens", () => {
    expect(githubSlug("Quick start")).toBe("quick-start");
    expect(githubSlug("Product catalog")).toBe("product-catalog");
  });
});

describe("parseReadmeHeadings", () => {
  it("parses ## and ### headings in document order, ignoring #### and deeper", () => {
    const md = "# Title\n\n## First\n\ntext\n\n### Nested\n\n## Second\n\n#### TooDeep\n";
    const headings = parseReadmeHeadings(md);
    expect(headings.map((h) => h.text)).toEqual(["First", "Nested", "Second"]);
    expect(headings.map((h) => h.level)).toEqual([2, 3, 2]);
  });

  it("against this project's own real README, every parsed slug matches what githubSlug independently computes", () => {
    const readmePath = path.resolve(__dirname, "../README.md");
    const headings = parseReadmeHeadings(readFileSync(readmePath, "utf-8"));
    expect(headings.length).toBeGreaterThan(20); // sanity: the real README has plenty of sections
    for (const h of headings) {
      expect(h.slug).toBe(githubSlug(h.text));
    }
  });
});

describe("resolveDocsTopic", () => {
  const headings = parseReadmeHeadings(readFileSync(path.resolve(__dirname, "../README.md"), "utf-8"));

  it("matches a real topic word against real README headings", () => {
    const match = resolveDocsTopic("score", headings);
    expect(match?.text).toContain("realism score");
  });

  it("prefers the shortest matching heading when several contain the search term", () => {
    const match = resolveDocsTopic("mutat", headings);
    expect(match?.text).toBe("Mutation testing (`test --mutate`)");
  });

  it("returns null for a topic with no real match, rather than guessing", () => {
    expect(resolveDocsTopic("this-topic-does-not-exist-anywhere", headings)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(resolveDocsTopic("SCORE", headings)?.text).toContain("score");
  });
});

describe("buildRepoUrl / buildDocsUrl", () => {
  it("derives the repo URL from package.json's real repository.url field, stripping git+ and .git", () => {
    const url = buildRepoUrl({ repository: { url: "git+https://github.com/Hung1510/Eco-Faker.git" } });
    expect(url).toBe("https://github.com/Hung1510/Eco-Faker");
  });

  it("falls back to homepage, then a hardcoded default, if repository is missing", () => {
    expect(buildRepoUrl({ homepage: "https://github.com/Hung1510/Eco-Faker#readme" })).toBe("https://github.com/Hung1510/Eco-Faker");
    expect(buildRepoUrl({})).toBe("https://github.com/Hung1510/Eco-Faker");
  });

  it("against this project's own real package.json, resolves to the real repo URL", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));
    expect(buildRepoUrl(packageJson)).toBe("https://github.com/Hung1510/Eco-Faker");
  });

  it("buildDocsUrl appends the heading's real slug, or #readme with no heading", () => {
    const packageJson = { repository: { url: "git+https://github.com/Hung1510/Eco-Faker.git" } };
    expect(buildDocsUrl(packageJson, null)).toBe("https://github.com/Hung1510/Eco-Faker#readme");
    expect(buildDocsUrl(packageJson, { level: 2, text: "Score", slug: "score" })).toBe("https://github.com/Hung1510/Eco-Faker#score");
  });
});
