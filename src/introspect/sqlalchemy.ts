import type { ParsedSchema } from "./prisma.js";

/**
 * Deliberately lightweight, mirroring prisma.ts: not a Python AST parser,
 * just a regex scanner good enough to pull table/column names out of a real
 * SQLAlchemy declarative-model file.
 *
 * Matches definitions like:
 *   class User(Base):
 *       __tablename__ = "users"
 *       id = Column(Integer, primary_key=True)
 *       full_name = Column(String)
 *       email_addr = Column(String)
 */
export function parseSqlAlchemySchema(source: string): ParsedSchema {
  const models: Record<string, string[]> = {};
  const classRegex = /class\s+(\w+)\s*\([^)]*\):([\s\S]*?)(?=\nclass\s+\w+\s*\(|$)/g;

  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(source)) !== null) {
    const [, className, body] = match;

    const tableNameMatch = body.match(/__tablename__\s*=\s*['"](\w+)['"]/);
    const tableName = tableNameMatch ? tableNameMatch[1] : className.toLowerCase();

    const fields: string[] = [];
    const fieldRegex = /^\s*(\w+)\s*=\s*(?:Column|relationship|mapped_column)\(/gm;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      fields.push(fieldMatch[1]);
    }

    models[tableName] = fields;
  }

  return { models };
}
