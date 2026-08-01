# Development Setup

**1. Clone and install:**
```bash
git clone https://github.com/Hung1510/Eco-Faker.git
cd Eco-Faker
npm install
```

**2. Build:**
```bash
npm run build
```

**3. Run the full test suite** — confirms everything actually works on your machine before you rely on any of it:
```bash
npm test
```

**4. Generate your first dataset:**
```bash
node dist/cli.js generate --users 50 --seed 1 --scenario black-friday --format json --output ./eco-data.json
```

**5. Run the same full verification pass CI runs, end to end:**
```bash
npx tsc --noEmit -p tsconfig.json   # typecheck
npm test                             # full unit test suite
npm run build                        # compile
npm run smoke-test                   # runs dist/ against every scenario preset, checks referential integrity
```

That's the full loop: clone → install → build → test → generate → serve. See [Run from Source](/getting-started/run-from-source) for the equivalent quick walkthrough, or continue below for the project layout and everything else contributing touches.

## Interactive visual playground

```bash
npm run build && npm run web
# open http://localhost:4173
```

Live sliders + Chart.js charts (cart status, shipment status, revenue), an RFM cohort panel, and a side-by-side scenario comparison, backed by a small Express API wrapping real `generate()`. See [Visual Tools](/guides/visual-tools) for this and the other browser-based demos.

## Dev container

Open in VS Code (or any [Dev Containers](https://containers.dev)-compatible tool), "Reopen in Container" — Node 22, git, `psql`, and a real, pre-seeded Postgres. First creation runs `npm install`, `npm run build`, and a one-time seed guarded by a row-count check (so rebuilding the `app` container doesn't re-insert into already-seeded data). Self-contained, not merged with the root `docker-compose.yml` (which has its own one-shot, non-idempotent `seed` service meant for a separate workflow — see [Database Tools](/cli/db-tools)).

## Next

- [Project Layout](/contributing/project-layout) — the full source map
- [Continuous Integration](/contributing/ci) — what CI runs, and the reusable GitHub Action
- [Publishing to npm](/contributing/publishing)
- [VS Code Extension](/contributing/vscode-extension) — developing the separate `vscode-extension/` package
