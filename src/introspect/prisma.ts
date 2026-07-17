/**
 * Deliberately lightweight. This is not a full Prisma AST parser -- it's a
 * line-oriented scanner good enough to pull `model Name { field Type ... }`
 * blocks out of a real .prisma file for column-name mapping purposes.
 * Relation fields, attributes (`@id`, `@default(...)`), and comments are
 * tolerated but not semantically understood.
 */
export interface ParsedSchema {
  /** modelName -> ordered list of field names declared in that model */
  models: Record<string, string[]>;
}

export function parsePrismaSchema(source: string): ParsedSchema {
  const models: Record<string, string[]> = {};
  const modelBlockRegex = /model\s+(\w+)\s*\{([^}]*)\}/g;

  let match: RegExpExecArray | null;
  while ((match = modelBlockRegex.exec(source)) !== null) {
    const [, modelName, body] = match;
    const fields: string[] = [];

    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fieldMatch = line.match(/^(\w+)\s+\S/);
      if (fieldMatch) fields.push(fieldMatch[1]);
    }

    models[modelName] = fields;
  }

  return { models };
}
