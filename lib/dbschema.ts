// The schema of the app a project builds: tables, columns, keys, relations, indexes and enums,
// never any rows.
// It comes from one of the project's database connections (readSchema in lib/appdb.ts) or, without
// one, from the repository's schema files (Prisma, Drizzle or SQL migrations). Pure functions: no
// database access here. The snapshot is saved on the project as `dbSchema`, and every AI prompt
// gets a compact version (schemaBlock, added by contextBlock in lib/appcontext.ts), so the AI uses
// real names.

export { tableKey, parsePrisma, parseDrizzle } from './dbschema/parse-drizzle';
export type { Column, ForeignKey, Table, Enum, Changes, Snapshot } from './dbschema/parse-drizzle';
export { parseSql, readFromRepo, fingerprint, diff, makeSnapshot } from './dbschema/parse-sql';
export { migrationCheck, tablesMentioned, schemaBlock } from './dbschema/migration-check';
