export interface ScaffoldFile {
  /** Path relative to the project root the CLI is run from. */
  path: string;
  contents: string;
}

export interface ScaffoldResult {
  files: ScaffoldFile[];
  /** Printed after the files are written -- what to actually run/import next. */
  nextSteps: string[];
}

export const SCAFFOLD_TARGETS = ["next", "msw"] as const;
export type ScaffoldTarget = (typeof SCAFFOLD_TARGETS)[number];

export interface ScaffoldOptions {
  /** Seed baked into the generated seed script (default: 1). */
  seed?: number;
}

/**
 * Writes real, runnable files wiring eco-faker into a fresh project --
 * distinct from `init --schema`, which maps eco-faker's own output onto a
 * schema *you already have*. This writes new files; that one adapts
 * eco-faker to existing ones. Two different jobs sharing the `init` verb
 * because that's genuinely what "the command you run after installing
 * this" means in both directions -- disambiguated by a positional target
 * (`init next`/`init msw`) vs. the `--schema` flag, not by two separate
 * command names, since a newcomer typing `eco-faker init --help` should
 * see both paths in one place.
 *
 * Deliberately just `next` and `msw` for now, not also `prisma` -- the
 * word "prisma" already means something different in this same command
 * (`init --schema-type prisma`, which maps onto an *existing* Prisma
 * schema). A third scaffold target reusing that word for "write a new
 * seed.ts" would collide in meaning with a flag two lines away in the
 * same `--help` output. `init --schema ./schema.prisma` already covers
 * the Prisma seeding path end to end; this isn't a gap, it's the same
 * feature under the name that already exists for it.
 */
export function buildScaffold(target: ScaffoldTarget, options: ScaffoldOptions = {}): ScaffoldResult {
  const seed = options.seed ?? 1;
  if (target === "next") return buildNextScaffold(seed);
  return buildMswScaffold(seed);
}

function buildNextScaffold(seed: number): ScaffoldResult {
  const seedScript = `// Generates a fake dataset and writes it to ./eco-data.json.
// Run: node scripts/eco-seed.mjs
import { generate, serialize } from "eco-faker";
import { writeFileSync } from "node:fs";

const dataset = generate({ seed: ${seed} });
// serialize(..., "json") is the same JSON eco-faker's own \`generate --format
// json\` CLI command writes -- it deliberately excludes the internal
// generation config, so this file is just the data, nothing else.
writeFileSync("./eco-data.json", serialize(dataset, "json"), "utf-8");
console.log(\`Wrote eco-data.json: \${dataset.orders.length} orders, \${dataset.users.length} users\`);
`;

  const routeHandler = `// GET /api/eco/orders, /api/eco/users, /api/eco/shipments, etc.
// GET /api/eco/orders?limit=20&offset=0 for pagination.
// Reads ./eco-data.json (see scripts/eco-seed.mjs) fresh on every request --
// fine for local dev; for anything longer-running, cache this in module
// scope instead of re-reading the file per request.
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

export async function GET(request: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const dataPath = path.join(process.cwd(), "eco-data.json");

  let dataset: Record<string, unknown[]>;
  try {
    dataset = JSON.parse(readFileSync(dataPath, "utf-8"));
  } catch {
    return NextResponse.json(
      { error: "eco-data.json not found -- run: node scripts/eco-seed.mjs" },
      { status: 500 }
    );
  }

  const rows = dataset[table];
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: \`No table "\${table}" in eco-data.json\` }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  return NextResponse.json({ data: rows.slice(offset, offset + limit), total: rows.length });
}
`;

  return {
    files: [
      { path: "scripts/eco-seed.mjs", contents: seedScript },
      { path: "app/api/eco/[table]/route.ts", contents: routeHandler },
    ],
    nextSteps: [
      "Next steps:",
      "  1. npm install eco-faker   (if not already installed)",
      "  2. node scripts/eco-seed.mjs   -- writes eco-data.json",
      "  3. npm run dev, then curl http://localhost:3000/api/eco/orders",
      "",
      "Re-run step 2 any time you want a fresh dataset (same seed = same data; edit the seed in scripts/eco-seed.mjs to change it).",
      "This route reads eco-data.json fresh per request -- fine for local dev; cache it in module scope for anything longer-running.",
    ],
  };
}

function buildMswScaffold(seed: number): ScaffoldResult {
  const handlers = `// Generates a fake dataset and turns it into MSW request handlers --
// GET /api/orders, /api/orders/:id, etc. for every table (paginated,
// filterable, sortable -- same semantics as eco-faker's \`serve\` command).
//
// Pagination uses ?page=&pageSize= (default page 1, pageSize 25) -- NOT
// ?limit=&offset=. Any query param that isn't page/pageSize/sort/order is
// treated as an exact-match filter on that field (e.g. ?status=delivered),
// so an unrecognized pagination param name doesn't error, it silently
// filters on a field that doesn't exist and returns an empty result.
import { generate } from "eco-faker";
import { toMswHandlers } from "eco-faker/msw";

export const dataset = generate({ seed: ${seed} });
export const handlers = toMswHandlers(dataset);
`;

  const browserSetup = `// For the browser (Storybook, dev-mode mocking in the actual app).
// Call \`await worker.start()\` once, early in your app's entry point.
import { setupWorker } from "msw/browser";
import { handlers } from "./eco-handlers";

export const worker = setupWorker(...handlers);
`;

  const serverSetup = `// For tests (Vitest/Jest) running in Node.
import { setupServer } from "msw/node";
import { handlers } from "./eco-handlers";

export const server = setupServer(...handlers);
`;

  return {
    files: [
      { path: "mocks/eco-handlers.ts", contents: handlers },
      { path: "mocks/browser.ts", contents: browserSetup },
      { path: "mocks/server.ts", contents: serverSetup },
    ],
    nextSteps: [
      "Next steps:",
      "  npm install eco-faker msw   (if not already installed)",
      "",
      "In a test setup file (e.g. vitest.setup.ts):",
      "  import { server } from \"./mocks/server\";",
      "  beforeAll(() => server.listen());",
      "  afterEach(() => server.resetHandlers());",
      "  afterAll(() => server.close());",
      "",
      "In your app's browser entry point (dev-mode mocking, e.g. main.tsx), guarded so it never runs in production:",
      "  if (process.env.NODE_ENV === \"development\") {",
      "    const { worker } = await import(\"./mocks/browser\");",
      "    await worker.start();",
      "  }",
      "",
      "Both mocks/browser.ts and mocks/server.ts import the exact same handlers from mocks/eco-handlers.ts, so tests and dev-mode mocking see identical fake data.",
    ],
  };
}
