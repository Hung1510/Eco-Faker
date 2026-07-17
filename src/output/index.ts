import type { Dataset } from "../types.js";
import type { SchemaMapping } from "../introspect/mapper.js";
import { toJson } from "./json.js";
import { toCsv } from "./csv.js";
import { toSql } from "./sql.js";

export type OutputFormat = "json" | "sql" | "csv";

export function serialize(dataset: Dataset, format: OutputFormat, mapping?: SchemaMapping): string {
  switch (format) {
    case "json":
      return toJson(dataset);
    case "sql":
      return toSql(dataset, mapping);
    case "csv":
      return toCsv(dataset, mapping);
    default: {
      const exhaustive: never = format;
      throw new Error(`Unknown output format: ${exhaustive}`);
    }
  }
}

export { toJson, toCsv, toSql };
