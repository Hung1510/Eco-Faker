# Visual Tools

Browser-based, no-terminal-required views over a real dataset (or a real `schema.prisma`, for the mapping designer).

## Interactive visual playground

```bash
npm run build && npm run web
# open http://localhost:4173
```

Live sliders + Chart.js charts (cart status, shipment status, revenue), an RFM cohort panel, and a side-by-side scenario comparison, backed by a small Express API wrapping real `generate()`.

## Customer journey timeline (`visualize`)

```bash
my-eco-gen visualize --users 300 --scenario black-friday --output ./journey.html
```

One customer's whole lifecycle as a self-contained, animated D3 timeline (works offline, no CDN). Without `--user`, picks whichever user has the richest journey.

```bash
my-eco-gen visualize --input ./eco-data.json --user <userId> --output ./journey.html
```

## Static browser demo

```bash
npm run build:static
# open web-static/index.html
```

The same generator bundled client-side with esbuild — no server. Sliders + scenario presets drive live Chart.js charts; checkboxes for the 5 real toggleable modules (recommendation data, inventory simulation, support tickets, transactional emails, anomaly injection) plus catalog size show a live-updating panel with both the equivalent `EcoFakerConfig` JSON and a real, copy-pasteable `my-eco-gen generate` command. `.github/workflows/pages.yml` deploys this to GitHub Pages on every push touching `web-static/` or `src/`.

## Interactive relationship explorer

```bash
npm run build:static
# open web-static/explorer.html
```

Miller-columns drill-down (User → Orders → Shipment/Returns), entirely client-side, same architecture as the playground above.

## Schema mapping designer

```bash
npm run build:static
# open web-static/mapping-designer.html
```

Paste a real `schema.prisma`, review the real column mapping `buildSchemaMapping` infers (the same function `init --schema` uses), and manually fix anything wrong before downloading `mapping.json` — a visual front end for a workflow that otherwise means hand-editing JSON in a text editor. Confidence-color-coded per column (green/yellow/red); overriding a column's target, or the whole table's target model, recomputes live and is reflected immediately in the exported file.

Scoped honestly to Prisma schemas only in this first slice — `init drizzle`/`init sqlalchemy` remain templates on the CLI side too, for the same reason (no schema parser for either yet).

## Related

- [Scaffolding](/cli/scaffolding) — the CLI-driven `init --schema` this designer is a visual front end for
