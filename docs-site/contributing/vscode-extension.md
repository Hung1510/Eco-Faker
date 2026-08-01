# VS Code Extension

A UI in front of the CLI, for generating data, browsing it, or scaffolding a project without leaving the editor — see [`vscode-extension/`](https://github.com/Hung1510/Eco-Faker/tree/main/vscode-extension) for the source and its own README.

## Commands

Available from the Command Palette (`Cmd/Ctrl+Shift+P`):

- **eco-faker: Generate Dataset** — prompts for users/scenario/format/output path, then offers to jump into the table viewer
- **eco-faker: View Dataset Tables** — browse any generated `dataset.json` in a webview: switch tables, search, sort, paginate, entirely client-side, plus a second **Relationships** tab (the same Miller-columns User → Orders → Shipment/Returns drill-down the static `web-static/explorer.html` demo establishes, ported into the same webview)
- **eco-faker: Scaffold Next.js Integration**
- **eco-faker: Scaffold MSW Integration**

The CLI-invoking commands shell out to the real `my-eco-gen` CLI (or `npx eco-faker` if it's not installed globally) — not a reimplementation of any generation logic.

## Development

```bash
cd vscode-extension
npm install
npm test          # real CLI spawned end-to-end + the table viewer's real HTML/JS run via jsdom, no vscode module involved
npm run package   # produces an installable .vsix via @vscode/vsce
```

The Relationships tab is only offered when the dataset actually has the shape it needs (non-empty `users`/`orders`/`shipments` — `returnRequests` optional); a dataset missing any of those gets a disabled tab explaining why, rather than an empty-looking one.

::: warning Test coverage, stated plainly
The extension's own logic that builds CLI invocations and the table viewer's entire client-side behavior (both view modes) are directly tested — including actually executing the real embedded script via jsdom: table switching, search, sort, pagination, and the full user → order → shipment/return drill-down with its breadcrumb and detail panel are all genuinely exercised. But `extension.ts`'s actual VS Code UI (QuickPicks, progress notifications, webview creation) hasn't been run inside a real Extension Host, since that needs downloading the actual VS Code binary from a host CI can't reach.
:::
