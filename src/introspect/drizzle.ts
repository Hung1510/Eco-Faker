import type { ParsedSchema } from "./prisma.js";

/**
 * Deliberately lightweight, mirroring prisma.ts: not a TypeScript AST parser,
 * just a regex scanner good enough to pull table/column names out of a real
 * Drizzle schema file for column-name mapping purposes.
 *
 * Matches definitions like:
 *   export const users = pgTable('users', {
 *     id: uuid('id').primaryKey(),
 *     fullName: text('full_name'),
 *     emailAddr: text('email_addr'),
 *   });
 *
 * For each field, prefers the DB-side column name (the string literal
 * argument to the column builder, e.g. `'full_name'`) over the JS property
 * name, since that's what will actually appear in generated SQL.
 */
export function parseDrizzleSchema(source: string): ParsedSchema {
  const models: Record<string, string[]> = {};
  // export const <jsName> = <pg|mysql|sqlite>Table('<table_name>', { ...body... })
  const tableRegex = /(?:pg|mysql|sqlite)Table\(\s*['"`](\w+)['"`]\s*,\s*\{([\s\S]*?)\n\}\s*\)/g;

  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(source)) !== null) {
    const [, tableName, body] = match;
    const fields: string[] = [];

    // <propertyName>: someColumnBuilder('<db_column_name>', ...)
    const fieldRegex = /(\w+)\s*:\s*\w+\(\s*['"`]([\w]+)['"`]/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const [, propertyName, dbColumnName] = fieldMatch;
      fields.push(dbColumnName || propertyName);
    }

    models[tableName] = fields;
  }

  return { models };
}
