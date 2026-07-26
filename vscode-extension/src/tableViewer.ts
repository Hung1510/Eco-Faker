export interface DatasetTables {
  [tableName: string]: unknown[];
}

/**
 * The entire client-side behavior lives in this one template string --
 * embedded into the generated HTML exactly once, and that exact same
 * embedded copy is what gets loaded and actually executed in
 * tests/tableViewer.test.ts via jsdom. There's deliberately no second,
 * "for testing purposes" copy of this logic anywhere: writing one as a
 * real TS function and a near-identical one as an embedded JS string
 * would be exactly the kind of drift this project has hit and fixed
 * before (a hand-maintained list, a hand-typed URL) -- here there's
 * only one copy, and it's verified by actually running it, not by
 * reading it and assuming it's equivalent to some other version.
 */
const CLIENT_SCRIPT = `
(function () {
  const state = { table: null, page: 1, pageSize: 25, search: "", sortColumn: null, sortDirection: "asc" };

  function columnsFor(tableName) {
    const rows = DATASET[tableName];
    if (!rows || rows.length === 0) return [];
    return Object.keys(rows[0]);
  }

  function stringifyCell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function matchesSearch(row, search) {
    if (!search) return true;
    const needle = search.toLowerCase();
    return Object.values(row).some((v) => stringifyCell(v).toLowerCase().includes(needle));
  }

  function compareValues(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  }

  function visibleRows() {
    const rows = DATASET[state.table] || [];
    let filtered = rows.filter((r) => matchesSearch(r, state.search));
    if (state.sortColumn) {
      filtered = filtered.slice().sort((a, b) => {
        const cmp = compareValues(a[state.sortColumn], b[state.sortColumn]);
        return state.sortDirection === "asc" ? cmp : -cmp;
      });
    }
    const totalRows = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * state.pageSize;
    return { rows: filtered.slice(start, start + state.pageSize), totalRows, totalPages };
  }

  function render() {
    const columns = columnsFor(state.table);
    const { rows, totalRows, totalPages } = visibleRows();

    const thead =
      "<tr>" +
      columns
        .map((c) => {
          const arrow = state.sortColumn === c ? (state.sortDirection === "asc" ? " \\u25B2" : " \\u25BC") : "";
          return '<th data-col="' + c + '">' + c + arrow + "</th>";
        })
        .join("") +
      "</tr>";

    const tbody = rows
      .map((row) => "<tr>" + columns.map((c) => "<td>" + escapeHtml(stringifyCell(row[c])) + "</td>").join("") + "</tr>")
      .join("");

    document.getElementById("table-head").innerHTML = thead;
    document.getElementById("table-body").innerHTML = tbody;
    document.getElementById("page-info").textContent = "Page " + state.page + " of " + totalPages + " (" + totalRows + " row" + (totalRows === 1 ? "" : "s") + (state.search ? " matching \\"" + state.search + "\\"" : "") + ")";
    document.getElementById("prev-page").disabled = state.page <= 1;
    document.getElementById("next-page").disabled = state.page >= totalPages;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function selectTable(name) {
    state.table = name;
    state.page = 1;
    state.sortColumn = null;
    render();
  }

  document.getElementById("table-select").addEventListener("change", (e) => selectTable(e.target.value));
  document.getElementById("search-box").addEventListener("input", (e) => {
    state.search = e.target.value;
    state.page = 1;
    render();
  });
  document.getElementById("prev-page").addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    render();
  });
  document.getElementById("next-page").addEventListener("click", () => {
    state.page = state.page + 1;
    render();
  });
  document.getElementById("table-head").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    const col = th.getAttribute("data-col");
    if (state.sortColumn === col) {
      state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    } else {
      state.sortColumn = col;
      state.sortDirection = "asc";
    }
    render();
  });

  window.__ecoFakerTableViewer = { selectTable, render, state };

  const firstTable = Object.keys(DATASET)[0];
  if (firstTable) selectTable(firstTable);
})();
`;

const STYLE = `
  body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #1e1e1e); padding: 12px; }
  select, input, button { font-family: inherit; padding: 4px 8px; margin-right: 8px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 0.85em; }
  th, td { border: 1px solid var(--vscode-panel-border, #444); padding: 4px 8px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
  th { cursor: pointer; user-select: none; position: sticky; top: 0; background: var(--vscode-editor-background, #1e1e1e); }
  #page-info { margin: 8px 0; opacity: 0.8; }
`;

/**
 * Builds a fully self-contained webview HTML document -- the entire
 * dataset is embedded as JSON and every interaction (table switching,
 * search, sort, pagination) runs client-side with no message-passing
 * back to the extension host, the same "no server, entirely client-side"
 * approach the project's own web-static/explorer.html already uses.
 *
 * Deliberately not paginated server-side or streamed -- fine for the
 * modest, hundreds-to-low-thousands-of-rows-per-table datasets this tool
 * is meant for local dev use with; a dataset generated at a much larger
 * scaleFactor would mean a correspondingly large embedded JSON blob, not
 * something this first slice tries to handle.
 */
export function buildTableViewerHtml(dataset: DatasetTables): string {
  const tableNames = Object.keys(dataset)
    .filter((name) => Array.isArray(dataset[name]))
    .sort();
  const options = tableNames.map((name) => `<option value="${name}">${name} (${dataset[name].length})</option>`).join("");

  // JSON.stringify(dataset) embedded raw inside a <script> tag breaks (and
  // is exploitable) the instant any string value in the dataset contains
  // a literal "</script>" substring -- the HTML parser, not the JS parser,
  // sees that sequence and closes the script tag right there, corrupting
  // everything after it. Caught directly: a dataset with a note field
  // containing "<script>alert(1)</script>" produced a real
  // "ReferenceError: DATASET is not defined" when actually loaded in
  // jsdom. Escaping "<" to its unicode escape is the standard mitigation
  // (the same one React/Next.js use for this exact situation) -- JSON and
  // JS parsers both read \u003c identically to a literal "<", but the HTML
  // parser never sees a tag-opening character to react to.
  const embeddedDataset = JSON.stringify(dataset).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${STYLE}</style>
</head>
<body>
  <select id="table-select">${options}</select>
  <input id="search-box" type="text" placeholder="Search all columns...">
  <button id="prev-page">&laquo; Prev</button>
  <button id="next-page">Next &raquo;</button>
  <div id="page-info"></div>
  <table>
    <thead id="table-head"></thead>
    <tbody id="table-body"></tbody>
  </table>
  <script>window.DATASET = ${embeddedDataset};</script>
  <script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}

/** Reads a dataset written by `generate --format json` -- already excludes the internal `config` field, so every top-level key here is a real table. */
export function loadDatasetTables(rawJson: string): DatasetTables {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const tables: DatasetTables = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) tables[key] = value;
  }
  return tables;
}
