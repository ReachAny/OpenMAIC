import { ASSET_PG_SCHEMA } from '@openmaic/storage/asset/pg';
import { DOCUMENT_PG_SCHEMA, type Queryable } from '@openmaic/storage/document/pg';
import { RUNTIME_PG_SCHEMA } from '@openmaic/storage/runtime/pg';
import { AGENT_SESSION_PG_SCHEMA } from '@openmaic/storage/agent-session/pg';
import { AGENT_SESSION_MATERIAL_PG_SCHEMA } from '@openmaic/storage/material/pg';
import { USER_SKILL_PG_SCHEMA } from '@openmaic/storage/skill/pg';

import { OWNER_MATERIAL_SCHEMA } from './owner-materials';
import { STAGE_META_SCHEMA } from './stage-meta';

export const OPENMAIC_EXPECTED_SCHEMA_SOURCES = [
  ...ASSET_PG_SCHEMA,
  DOCUMENT_PG_SCHEMA,
  RUNTIME_PG_SCHEMA,
  AGENT_SESSION_PG_SCHEMA,
  AGENT_SESSION_MATERIAL_PG_SCHEMA,
  USER_SKILL_PG_SCHEMA,
  STAGE_META_SCHEMA,
  OWNER_MATERIAL_SCHEMA,
] as const;

interface ExpectedTable {
  columns: Set<string>;
  constraints: { check: number; foreignKey: number; primaryKey: number; unique: number };
}

export interface ExpectedCatalogShape {
  indexes: Set<string>;
  tables: Map<string, ExpectedTable>;
}

function tableOf(shape: ExpectedCatalogShape, name: string): ExpectedTable {
  const existing = shape.tables.get(name);
  if (existing) return existing;
  const created: ExpectedTable = {
    columns: new Set(),
    constraints: { check: 0, foreignKey: 0, primaryKey: 0, unique: 0 },
  };
  shape.tables.set(name, created);
  return created;
}

export function deriveExpectedCatalogShape(
  sources: readonly string[] = OPENMAIC_EXPECTED_SCHEMA_SOURCES,
): ExpectedCatalogShape {
  const shape: ExpectedCatalogShape = { indexes: new Set(), tables: new Map() };
  const sql = sources.join('\n;\n').replace(/--[^\r\n]*/g, ' ');
  for (const match of sql.matchAll(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi,
  )) {
    const table = tableOf(shape, match[1]);
    const body = match[2];
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim().replace(/,$/, '');
      if (!trimmed || /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|REFERENCES|CHECK)\b/i.test(trimmed)) continue;
      const column = /^"?([a-z_][a-z0-9_]*)"?\s+/i.exec(trimmed)?.[1];
      if (column) table.columns.add(column);
    }
    table.constraints.primaryKey += (body.match(/\bPRIMARY\s+KEY\b/gi) ?? []).length;
    table.constraints.unique += (body.match(/\bUNIQUE\s*\(/gi) ?? []).length;
    table.constraints.foreignKey += (body.match(/\bREFERENCES\s+[a-z_]/gi) ?? []).length;
    table.constraints.check += (body.match(/\bCHECK\s*\(/gi) ?? []).length;
  }
  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/gi,
  )) {
    tableOf(shape, match[1]).columns.add(match[2]);
  }
  for (const match of sql.matchAll(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/gi,
  )) {
    shape.indexes.add(match[1]);
  }
  return shape;
}

interface ColumnRow extends Record<string, unknown> {
  table_name: string;
  column_name: string;
}

interface IndexRow extends Record<string, unknown> {
  indexname: string;
}

interface ConstraintRow extends Record<string, unknown> {
  table_name: string;
  constraint_type: 'c' | 'f' | 'p' | 'u';
  count: number | string;
}

export class OpenMaicCatalogNotReadyError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`OpenMAIC catalog is not ready: ${missing.join(', ')}`);
    this.name = 'OpenMaicCatalogNotReadyError';
  }
}

export async function assertOpenMaicCatalogReady(
  queryable: Queryable,
  schema: 'openmaic_draft' | 'openmaic_published',
  expected: ExpectedCatalogShape = deriveExpectedCatalogShape(),
): Promise<void> {
  const tableNames = [...expected.tables.keys()];
  const columns = await queryable.query<ColumnRow>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = ANY($2::text[])`,
    [schema, tableNames],
  );
  const indexes = await queryable.query<IndexRow>(
    `SELECT indexname
       FROM pg_catalog.pg_indexes
      WHERE schemaname = $1`,
    [schema],
  );
  const constraints = await queryable.query<ConstraintRow>(
    `SELECT rel.relname AS table_name, con.contype AS constraint_type, COUNT(*)::text AS count
       FROM pg_catalog.pg_constraint con
       JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
       JOIN pg_catalog.pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = $1 AND rel.relname = ANY($2::text[])
      GROUP BY rel.relname, con.contype`,
    [schema, tableNames],
  );

  const actualColumns = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const actualIndexes = new Set(indexes.rows.map((row) => row.indexname));
  const actualConstraints = new Map(
    constraints.rows.map((row) => [`${row.table_name}:${row.constraint_type}`, Number(row.count)]),
  );
  const missing: string[] = [];
  for (const [tableName, table] of expected.tables) {
    for (const column of table.columns) {
      if (!actualColumns.has(`${tableName}.${column}`))
        missing.push(`column:${tableName}.${column}`);
    }
    const requirements = [
      ['c', table.constraints.check],
      ['f', table.constraints.foreignKey],
      ['p', table.constraints.primaryKey],
      ['u', table.constraints.unique],
    ] as const;
    for (const [type, count] of requirements) {
      if (count > 0 && (actualConstraints.get(`${tableName}:${type}`) ?? 0) < count) {
        missing.push(`constraint:${tableName}:${type}`);
      }
    }
  }
  for (const index of expected.indexes) {
    if (!actualIndexes.has(index)) missing.push(`index:${index}`);
  }
  if (missing.length > 0) throw new OpenMaicCatalogNotReadyError(missing);
}
