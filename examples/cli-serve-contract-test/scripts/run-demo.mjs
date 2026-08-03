// scripts/run-demo.mjs
//
// Orchestrates three real scenarios against a real `my-eco-gen serve`
// process and a real `my-eco-gen test --contract` run -- no mocking of the
// CLI itself. Run with `npm run demo` for the full walkthrough (used as
// this example's CI smoke test too), or `npm run demo:pass` /
// `demo:fail-auth` / `demo:fail-drift` individually.

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Resolve the real CLI entry point via Node's own module resolution against
// eco-faker's own package.json, rather than trusting npm to have created a
// `node_modules/.bin/my-eco-gen` symlink. The symlink *should* always be
// there for a package with a "bin" field, and it reliably was in every
// local test here (including a from-scratch `npm ci` matching CI's exact
// step order) -- but it was confirmed missing in real CI at least once,
// for a reason not reproduced locally, so depend on it as little as
// possible. `eco-faker` being resolvable as a package is *not* optional --
// every other example's `import { generate } from "eco-faker"` already
// requires it to work in this same install -- so resolving off of that is
// strictly more robust than a second, separate npm behavior (bin-linking)
// this script doesn't otherwise need at all.
const require = createRequire(import.meta.url);
const ecoFakerPackageJsonPath = require.resolve("eco-faker/package.json");
const ecoFakerRoot = path.dirname(ecoFakerPackageJsonPath);
const ecoFakerPackageJson = JSON.parse(readFileSync(ecoFakerPackageJsonPath, "utf-8"));
const binRelativePath =
  typeof ecoFakerPackageJson.bin === "string" ? ecoFakerPackageJson.bin : ecoFakerPackageJson.bin?.["my-eco-gen"];
if (!binRelativePath) {
  throw new Error(`eco-faker's package.json at ${ecoFakerPackageJsonPath} has no "my-eco-gen" bin entry.`);
}
const cliPath = path.resolve(ecoFakerRoot, binRelativePath);
if (!existsSync(cliPath)) {
  throw new Error(`Resolved eco-faker's bin entry to ${cliPath}, but that file doesn't exist -- was \`npm run build\` run?`);
}
// Invoke as `node <cliPath> <args>` throughout, instead of executing a bin
// symlink directly -- sidesteps the symlink question entirely.
const bin = process.execPath; // the current `node` binary
const PORT = 4900;
const API_KEY = "SECRET123";
const CONTRACT_PATH = path.join(rootDir, "openapi.json");
const DRIFTED_CONTRACT_PATH = path.join(rootDir, "openapi-drifted.json");

function run(args) {
  const result = spawnSync(bin, [cliPath, ...args], { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`node ${cliPath} ${args.join(" ")} exited ${result.status}\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

// Unlike execFileSync (whose stderr silently inherits straight to the
// parent process on success but also gets attached to the thrown error on
// failure -- printing failing runs' output twice if you log the caught
// error's content), spawnSync always returns {stdout, stderr, status}
// without touching the parent's own streams, so capturing "what did this
// command print" is consistent whether it succeeded or failed.
function runCapturingFailure(args) {
  const result = spawnSync(bin, [cliPath, ...args], { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return { output: result.stdout + result.stderr, status: result.status ?? 1 };
}

async function waitForServer(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server at ${url} never came up`);
}

function section(title) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

async function main() {
  section("1. Generating an OpenAPI contract from the dataset shape");
  run(["openapi-export", "--seed", "42", "--users", "20", "--output", CONTRACT_PATH, "--port", String(PORT)]);
  console.log(`Wrote ${CONTRACT_PATH}`);

  section("2. Starting a real mock API (auth required)");
  const server = spawn(bin, [cliPath, "serve", "--seed", "42", "--users", "20", "--port", String(PORT), "--api-key", API_KEY, "--quiet"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  await waitForServer(`http://localhost:${PORT}/`);
  console.log(`Server up on http://localhost:${PORT}`);

  let allExpectedOutcomesMatched = true;

  try {
    section("3. PASSING case -- correct auth header, unmodified contract");
    const pass = runCapturingFailure([
      "test",
      "--url",
      `http://localhost:${PORT}`,
      "--contract",
      CONTRACT_PATH,
      "--header",
      `Authorization: Bearer ${API_KEY}`,
    ]);
    console.log(pass.output);
    const passMatch = pass.output.match(/(\d+) passed, (\d+) failed/);
    const passOk = pass.status === 0 && passMatch && passMatch[2] === "0";
    console.log(passOk ? "EXPECTED: all checks passed." : "UNEXPECTED: expected 0 failures.");
    allExpectedOutcomesMatched &&= Boolean(passOk);

    section("4. FAILING case -- missing auth header (real, common misconfiguration)");
    const failAuth = runCapturingFailure(["test", "--url", `http://localhost:${PORT}`, "--contract", CONTRACT_PATH]);
    console.log(failAuth.output);
    const authMatch = failAuth.output.match(/(\d+) passed, (\d+) failed/);
    const authFailedAsExpected = authMatch && Number(authMatch[2]) > 0;
    console.log(
      authFailedAsExpected
        ? "EXPECTED: list requests succeed (401 is a documented status), but detail requests fail --\n" +
            "          no sample id could be harvested from an empty/401'd list response."
        : "UNEXPECTED: expected some failures from the missing auth header."
    );
    allExpectedOutcomesMatched &&= Boolean(authFailedAsExpected);

    section("5. FAILING case -- contract drift (schema declares a field the API doesn't return)");
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf-8"));
    const productsSchema = contract.components.schemas.Products;
    productsSchema.properties.loyaltyTier = { type: "string" };
    productsSchema.required = [...(productsSchema.required ?? []), "loyaltyTier"];
    writeFileSync(DRIFTED_CONTRACT_PATH, JSON.stringify(contract, null, 2));

    const failDrift = runCapturingFailure([
      "test",
      "--url",
      `http://localhost:${PORT}`,
      "--contract",
      DRIFTED_CONTRACT_PATH,
      "--header",
      `Authorization: Bearer ${API_KEY}`,
    ]);
    console.log(failDrift.output);
    const driftCaught = failDrift.output.includes("loyaltyTier");
    console.log(
      driftCaught
        ? "EXPECTED: schema validation caught the field the contract now (falsely) requires."
        : "UNEXPECTED: expected a loyaltyTier validation failure."
    );
    allExpectedOutcomesMatched &&= driftCaught;
  } finally {
    server.kill();
  }

  section(allExpectedOutcomesMatched ? "All three scenarios behaved as documented." : "MISMATCH -- see above.");
  if (!allExpectedOutcomesMatched) process.exit(1);
}

main();
