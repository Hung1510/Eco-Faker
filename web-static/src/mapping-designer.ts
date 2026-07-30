import { parsePrismaSchema, buildSchemaMapping, matchColumn, CANONICAL_COLUMNS, CORE_TABLES, type SchemaMapping, type ParsedSchema } from "../../src/browser.js";

const schemaInputEl = document.getElementById("schemaInput") as HTMLTextAreaElement;
const modelsFoundEl = document.getElementById("modelsFound")!;
const parseErrorEl = document.getElementById("parseError")!;
const tableSelectEl = document.getElementById("tableSelect") as HTMLSelectElement;
const targetModelRowEl = document.getElementById("targetModelRow")!;
const mappingBodyEl = document.getElementById("mappingBody")!;
const mappingOutputEl = document.getElementById("mappingOutput")!;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;

// The 6 "core" tables a real Prisma seed script actually consumes
// (buildPrismaSeedScript in orm-scaffold.ts) -- this page focuses editing
// on those, while the exported mapping.json still covers every canonical
// table, matching `my-eco-gen init --schema`'s own output exactly.
// Imported directly from orm-scaffold.ts's own real CORE_TABLES (via
// browser.ts) rather than duplicated as a literal here -- confirmed this
// bundles cleanly for a browser target despite orm-scaffold.ts also
// containing Node-only template-literal *text* (embedded seed-script
// source, never actually imported/executed by this module).
const EDITABLE_TABLES = CORE_TABLES as readonly string[];

let parsedSchema: ParsedSchema | null = null;
/** The full, real mapping for every canonical table -- recomputed from the parsed schema, then patched with any manual overrides below. */
let fullMapping: SchemaMapping = {};
/** table -> canonicalColumn -> user-picked target column, overriding whatever buildSchemaMapping auto-matched. */
const overrides: Record<string, Record<string, string>> = {};
/** table -> user-picked target model, overriding the auto-matched one (or filling in a null one). */
const modelOverrides: Record<string, string> = {};

for (const table of EDITABLE_TABLES) {
  const option = document.createElement("option");
  option.value = table;
  option.textContent = table;
  tableSelectEl.appendChild(option);
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.7) return "conf-high";
  if (confidence >= 0.4) return "conf-mid";
  return "conf-low";
}

function recomputeMapping() {
  if (!parsedSchema) {
    fullMapping = {};
    return;
  }
  fullMapping = buildSchemaMapping(parsedSchema, Object.keys(CANONICAL_COLUMNS));

  // Apply model overrides: if the user picked a different target model for
  // a table, re-match every column against THAT model's real fields
  // (not just relabel the model name while leaving stale column matches).
  for (const [table, modelName] of Object.entries(modelOverrides)) {
    const fields = parsedSchema.models[modelName] ?? [];
    const columns: Record<string, { targetColumn: string; confidence: number }> = {};
    for (const column of CANONICAL_COLUMNS[table] ?? []) {
      columns[column] = fields.length > 0 ? matchColumn(column, fields) : { targetColumn: column, confidence: 0 };
    }
    fullMapping[table] = { targetModel: modelName, columns };
  }

  // Apply column-level overrides on top.
  for (const [table, cols] of Object.entries(overrides)) {
    if (!fullMapping[table]) continue;
    for (const [column, targetColumn] of Object.entries(cols)) {
      fullMapping[table].columns[column] = { targetColumn, confidence: 1 }; // a manual pick is treated as full confidence
    }
  }
}

function renderModelsFound() {
  modelsFoundEl.innerHTML = "";
  if (!parsedSchema) return;
  for (const modelName of Object.keys(parsedSchema.models)) {
    const chip = document.createElement("span");
    chip.className = "model-chip";
    chip.textContent = `${modelName} (${parsedSchema.models[modelName].length} fields)`;
    modelsFoundEl.appendChild(chip);
  }
}

function renderTargetModelRow(table: string) {
  targetModelRowEl.innerHTML = "";
  if (!parsedSchema) return;
  const label = document.createElement("span");
  label.textContent = "Target model:";
  const select = document.createElement("select");
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "(no match -- pick one)";
  select.appendChild(noneOption);
  for (const modelName of Object.keys(parsedSchema.models)) {
    const opt = document.createElement("option");
    opt.value = modelName;
    opt.textContent = modelName;
    select.appendChild(opt);
  }
  select.value = fullMapping[table]?.targetModel ?? "";
  select.addEventListener("change", () => {
    if (select.value) {
      modelOverrides[table] = select.value;
    } else {
      delete modelOverrides[table];
    }
    // A new target model invalidates any column overrides picked against
    // the previous model's field list -- they'd silently reference fields
    // that don't exist on the new model otherwise.
    delete overrides[table];
    recomputeMapping();
    renderTable(table);
    renderOutput();
  });
  targetModelRowEl.appendChild(label);
  targetModelRowEl.appendChild(select);
}

function renderTable(table: string) {
  mappingBodyEl.innerHTML = "";
  const tableMapping = fullMapping[table];
  const modelName = tableMapping?.targetModel;
  const fields = modelName ? parsedSchema?.models[modelName] ?? [] : [];

  for (const column of CANONICAL_COLUMNS[table] ?? []) {
    const mapping = tableMapping?.columns[column] ?? { targetColumn: column, confidence: 0 };
    const row = document.createElement("tr");

    const colCell = document.createElement("td");
    colCell.textContent = column;
    row.appendChild(colCell);

    const targetCell = document.createElement("td");
    if (fields.length > 0) {
      const select = document.createElement("select");
      const unmatchedOption = document.createElement("option");
      unmatchedOption.value = "";
      unmatchedOption.textContent = "(none -- skip this column)";
      select.appendChild(unmatchedOption);
      for (const field of fields) {
        const opt = document.createElement("option");
        opt.value = field;
        opt.textContent = field;
        select.appendChild(opt);
      }
      select.value = fields.includes(mapping.targetColumn) ? mapping.targetColumn : "";
      select.addEventListener("change", () => {
        overrides[table] = overrides[table] ?? {};
        if (select.value) {
          overrides[table][column] = select.value;
        } else {
          delete overrides[table][column];
        }
        recomputeMapping();
        renderTable(table);
        renderOutput();
      });
      targetCell.appendChild(select);
    } else {
      targetCell.textContent = "(no target model matched yet)";
    }
    row.appendChild(targetCell);

    const confCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `confidence ${confidenceClass(mapping.confidence)}`;
    badge.textContent = mapping.confidence.toFixed(2);
    confCell.appendChild(badge);
    row.appendChild(confCell);

    mappingBodyEl.appendChild(row);
  }
}

function renderOutput() {
  mappingOutputEl.textContent = JSON.stringify(fullMapping, null, 2);
}

function renderAll() {
  const table = tableSelectEl.value;
  renderModelsFound();
  renderTargetModelRow(table);
  renderTable(table);
  renderOutput();
}

let debounceHandle: ReturnType<typeof setTimeout> | undefined;
schemaInputEl.addEventListener("input", () => {
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    parseErrorEl.textContent = "";
    try {
      parsedSchema = schemaInputEl.value.trim() ? parsePrismaSchema(schemaInputEl.value) : null;
      if (parsedSchema && Object.keys(parsedSchema.models).length === 0) {
        parseErrorEl.textContent = "No `model Name { ... }` blocks found -- paste a real schema.prisma's model definitions.";
      }
    } catch (err) {
      parsedSchema = null;
      parseErrorEl.textContent = `Couldn't parse this as a Prisma schema: ${(err as Error).message}`;
    }
    // Overrides referencing a model/schema that no longer exists after a
    // re-paste would silently show stale, meaningless picks -- clear them
    // rather than carry them forward across a genuinely new schema.
    for (const key of Object.keys(overrides)) delete overrides[key];
    for (const key of Object.keys(modelOverrides)) delete modelOverrides[key];
    recomputeMapping();
    renderAll();
  }, 200);
});

tableSelectEl.addEventListener("change", renderAll);

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(fullMapping, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mapping.json";
  a.click();
  URL.revokeObjectURL(url);
});

recomputeMapping();
renderAll();
