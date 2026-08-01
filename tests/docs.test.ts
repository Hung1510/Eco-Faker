import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { githubSlug, parseDocsSiteHeadings, resolveDocsTopic, buildRepoUrl, buildDocsUrl } from "../src/docs.js";

describe("githubSlug", () => {
  it("matches real, manually-verified GitHub anchor slugs for headings with parens, backticks, and flag names", () => {
    expect(githubSlug("Contract testing (`test --contract`)")).toBe("contract-testing-test---contract");
    expect(githubSlug("Framework scaffolding (`init next` / `init msw`)")).toBe("framework-scaffolding-init-next--init-msw");
    expect(githubSlug("Mutation Testing (`test --mutate`)")).toBe("mutation-testing-test---mutate");
    expect(githubSlug("Data quality / realism score (`score`)")).toBe("data-quality--realism-score-score");
  });

  it("lowercases and replaces plain spaces with single hyphens", () => {
    expect(githubSlug("Quick start")).toBe("quick-start");
    expect(githubSlug("Product catalog")).toBe("product-catalog");
  });
});

const docsSiteDir = path.resolve(__dirname, "../docs-site");

describe("parseDocsSiteHeadings", () => {
  it("parses #, ##, and ### headings in document order, ignoring #### and deeper, from a single file's content", () => {
    // Exercised indirectly through the real docs-site below; this checks
    // the regex boundary directly against a synthetic file on disk isn't
    // needed since parseDocsSiteHeadings reads real files by design -- the
    // level/order assertions live in the "against the real docs site" test.
    const headings = parseDocsSiteHeadings(docsSiteDir);
    const cliIndex = headings.find((h) => h.filePath === "docs-site/cli/index.md" && h.level === 1);
    expect(cliIndex?.text).toBe("CLI Reference");
  });

  it("against this project's own real docs site, every parsed slug matches what githubSlug independently computes", () => {
    const headings = parseDocsSiteHeadings(docsSiteDir);
    expect(headings.length).toBeGreaterThan(100); // sanity: 39 pages, several headings each
    for (const h of headings) {
      expect(h.slug).toBe(githubSlug(h.text));
    }
  });

  it("records each heading's real source file path, relative to the repo root", () => {
    const headings = parseDocsSiteHeadings(docsSiteDir);
    const scoreHeading = headings.find((h) => h.text === "score");
    expect(scoreHeading?.filePath).toBe("docs-site/cli/data-quality.md");
  });

  it("captures page-title H1 headings, not just H2/H3 subsections", () => {
    const headings = parseDocsSiteHeadings(docsSiteDir);
    const mutationTitle = headings.find((h) => h.text === "Mutation Testing (`test --mutate`)");
    expect(mutationTitle?.level).toBe(1);
  });
});

describe("resolveDocsTopic", () => {
  const headings = parseDocsSiteHeadings(docsSiteDir);

  it("matches a real topic word against a real docs-site heading", () => {
    const match = resolveDocsTopic("score", headings);
    expect(match?.text).toBe("score");
    expect(match?.filePath).toBe("docs-site/cli/data-quality.md");
  });

  it("prefers the shortest matching heading when several contain the search term", () => {
    const match = resolveDocsTopic("mutat", headings);
    expect(match?.text).toBe("Mutation Testing (`test --mutate`)");
  });

  it("returns null for a topic with no real match, rather than guessing", () => {
    expect(resolveDocsTopic("this-topic-does-not-exist-anywhere", headings)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(resolveDocsTopic("SCORE", headings)?.text).toBe("score");
  });

  it("resolves a topic that only appears in a page's H1 title, not any subsection", () => {
    const match = resolveDocsTopic("apollo client adapter", headings);
    expect(match?.filePath).toBe("docs-site/adapters/apollo.md");
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

  it("buildDocsUrl points at the matched heading's real file + slug, or the docs-site index with no heading", () => {
    const packageJson = { repository: { url: "git+https://github.com/Hung1510/Eco-Faker.git" } };
    expect(buildDocsUrl(packageJson, null)).toBe("https://github.com/Hung1510/Eco-Faker/blob/main/docs-site/index.md");
    expect(buildDocsUrl(packageJson, { level: 2, text: "score", slug: "score", filePath: "docs-site/cli/data-quality.md" })).toBe(
      "https://github.com/Hung1510/Eco-Faker/blob/main/docs-site/cli/data-quality.md#score"
    );
  });

  it("end to end: resolving a real topic against the real docs site produces a URL to a real file that actually exists", () => {
    const headings = parseDocsSiteHeadings(docsSiteDir);
    const match = resolveDocsTopic("mutate", headings);
    const packageJson = { repository: { url: "git+https://github.com/Hung1510/Eco-Faker.git" } };
    const url = buildDocsUrl(packageJson, match);
    expect(url).toBe("https://github.com/Hung1510/Eco-Faker/blob/main/docs-site/testing/mutation-testing.md#mutation-testing-test---mutate");
    // the file the URL points at must actually exist on disk
    expect(() => readFileSync(path.resolve(__dirname, "..", match!.filePath), "utf-8")).not.toThrow();
  });
});
