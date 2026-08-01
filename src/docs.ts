import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface DocHeading {
  level: 1 | 2 | 3;
  text: string;
  slug: string;
  /** Path to the source file, relative to the repo root, e.g. `docs-site/cli/generate.md`. */
  filePath: string;
}

/** @deprecated kept as an alias -- the docs site replaced the single-README model this type name described. */
export type ReadmeHeading = DocHeading;

/**
 * Replicates github-slugger's actual algorithm (the one GitHub itself uses
 * to build in-page anchor links from markdown headings) closely enough for
 * real links to resolve: lowercase, strip anything that isn't a word
 * character/hyphen/space, then convert every space to a hyphen -- one for
 * one, never collapsed. That last part matters: a heading like "Contract
 * testing (`test --contract`)" produces `contract-testing-test---contract`
 * (three hyphens in the middle, from one literal space plus the flag's own
 * two literal hyphens), not a tidied-up single hyphen -- verified directly
 * against real anchors on this project's own docs before being trusted
 * here, not assumed from a description of the algorithm.
 */
export function githubSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
}

/** Parses every `# `/`## `/`### ` heading out of one markdown file's raw content, in document order. Skips anything inside a fenced code block (```), since a shell comment like `# ok: created` inside an example is not a heading. */
function parseHeadingsFromContent(content: string): { level: 1 | 2 | 3; text: string; slug: string }[] {
  const headings: { level: 1 | 2 | 3; text: string; slug: string }[] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#|##|###) (.+)$/);
    if (!match) continue;
    const level = match[1].length as 1 | 2 | 3;
    const text = match[2].trim();
    headings.push({ level, text, slug: githubSlug(text) });
  }
  return headings;
}

/**
 * Walks every `.md` file under `docs-site/` (the real VitePress documentation
 * site) and parses its `##`/`###` headings, in directory-listing order.
 * Deliberately reads the real files at runtime rather than hand-maintaining
 * a topic->page list, so this can never drift out of sync with the docs
 * site's actual structure -- the same reasoning that motivated reading a
 * single README's headings at runtime before the docs were split into
 * multiple pages.
 */
export function parseDocsSiteHeadings(docsSiteDir: string): DocHeading[] {
  const headings: DocHeading[] = [];

  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const content = readFileSync(fullPath, "utf-8");
      const relativePath = path.relative(path.dirname(docsSiteDir), fullPath).split(path.sep).join("/");
      for (const h of parseHeadingsFromContent(content)) {
        headings.push({ ...h, filePath: relativePath });
      }
    }
  }

  walk(docsSiteDir);
  return headings;
}

/** @deprecated use {@link parseDocsSiteHeadings} -- kept only so old imports don't hard-fail; always returns an empty list, since there is no longer one README to parse this way. */
export function parseReadmeHeadings(_readmeContent: string): DocHeading[] {
  return [];
}

/**
 * Best-effort case-insensitive substring match against real heading text
 * -- "score" matches "score" (in `cli/data-quality.md`), "mutate" matches
 * "Mutation Testing (`test --mutate`)" (in `testing/mutation-testing.md`).
 * Prefers the shortest matching heading (the most specific one) when
 * several contain the search term, and returns null (never a guess) when
 * nothing matches, so the caller can show real options instead of opening
 * a wrong link.
 */
export function resolveDocsTopic(topic: string, headings: DocHeading[]): DocHeading | null {
  const needle = topic.toLowerCase();
  const matches = headings.filter((h) => h.text.toLowerCase().includes(needle) || h.slug.includes(needle));
  if (matches.length === 0) return null;
  return matches.reduce((best, h) => (h.text.length < best.text.length ? h : best));
}

/** Derives the browsable GitHub repo URL from package.json's own `repository.url` field, rather than a second, hand-typed copy of the same URL that could drift if the repo ever moves. */
export function buildRepoUrl(packageJson: { repository?: { url?: string } | string; homepage?: string }): string {
  const raw = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  if (raw) {
    return raw.replace(/^git\+/, "").replace(/\.git$/, "");
  }
  if (packageJson.homepage) {
    return packageJson.homepage.replace(/#.*$/, "");
  }
  return "https://github.com/Hung1510/Eco-Faker";
}

/**
 * Builds a URL to the matched heading's real page on GitHub (rendered
 * markdown blob view, which resolves `#slug` anchors the same way the old
 * single-README links did) -- or the docs site's own index page when no
 * topic was given/matched.
 */
export function buildDocsUrl(packageJson: { repository?: { url?: string } | string; homepage?: string }, heading: DocHeading | null): string {
  const base = buildRepoUrl(packageJson);
  if (heading) return `${base}/blob/main/${heading.filePath}#${heading.slug}`;
  return `${base}/blob/main/docs-site/index.md`;
}
