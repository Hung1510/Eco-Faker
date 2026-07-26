export interface ReadmeHeading {
  level: 2 | 3;
  text: string;
  slug: string;
}

/**
 * Replicates github-slugger's actual algorithm (the one GitHub itself uses
 * to build in-page anchor links from markdown headings) closely enough for
 * real links to resolve: lowercase, strip anything that isn't a word
 * character/hyphen/space, then convert every space to a hyphen -- one for
 * one, never collapsed. That last part matters: a heading like "Contract
 * testing (`test --contract`)" produces `contract-testing-test---contract`
 * (three hyphens in the middle, from one literal space plus the flag's own
 * two literal hyphens), not a tidied-up single hyphen -- verified directly
 * against real anchors on this project's own README before being trusted
 * here, not assumed from a description of the algorithm.
 */
export function githubSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
}

/** Parses every `## `/`### ` heading out of a README's raw markdown, in document order. Deliberately reads the real file at runtime rather than hand-maintaining a topic->section list, so this can never drift out of sync with the README's actual headings. */
export function parseReadmeHeadings(readmeContent: string): ReadmeHeading[] {
  const headings: ReadmeHeading[] = [];
  for (const line of readmeContent.split("\n")) {
    const match = line.match(/^(##|###) (.+)$/);
    if (!match) continue;
    const level = match[1].length === 2 ? 2 : 3;
    const text = match[2].trim();
    headings.push({ level: level as 2 | 3, text, slug: githubSlug(text) });
  }
  return headings;
}

/**
 * Best-effort case-insensitive substring match against real heading text
 * -- "score" matches "Data quality / realism score (`score`)", "mutate"
 * matches "Mutation testing (`test --mutate`)". Prefers the shortest
 * matching heading (the most specific one) when several contain the
 * search term, and returns null (never a guess) when nothing matches, so
 * the caller can show real options instead of opening a wrong link.
 */
export function resolveDocsTopic(topic: string, headings: ReadmeHeading[]): ReadmeHeading | null {
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

export function buildDocsUrl(packageJson: { repository?: { url?: string } | string; homepage?: string }, heading: ReadmeHeading | null): string {
  const base = buildRepoUrl(packageJson);
  return heading ? `${base}#${heading.slug}` : `${base}#readme`;
}
