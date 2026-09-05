import { describe, expect, test } from 'vitest';
import type { QueryResult, Queryable } from '@openmaic/storage/document/pg';

import {
  assertOpenMaicCatalogReady,
  deriveExpectedCatalogShape,
} from '@/lib/persistence/catalog-readiness';

describe('ReachAcademy catalog readiness', () => {
  test('derives tables, columns, indexes, and constraints from upstream constants', () => {
    const shape = deriveExpectedCatalogShape();
    expect([...shape.tables.keys()]).toEqual(
      expect.arrayContaining([
        'asset_blobs',
        'asset_entries',
        'document_stages',
        'document_scenes',
        'runtime_sessions',
        'runtime_records',
        'stage_meta',
        'owner_material',
      ]),
    );
    expect(shape.tables.get('document_stages')?.columns).toContain('owner_id');
    expect(shape.indexes).toContain('asset_entries_principal_idx');
  });

  test('executes only read-only catalog queries', async () => {
    const expected = deriveExpectedCatalogShape();
    const statements: string[] = [];
    const queryable: Queryable = {
      async query<TRow extends Record<string, unknown>>(text: string): Promise<QueryResult<TRow>> {
        statements.push(text);
        let rows: Record<string, unknown>[];
        if (text.includes('information_schema.columns')) {
          rows = [...expected.tables].flatMap(([table, value]) =>
            [...value.columns].map((column) => ({ table_name: table, column_name: column })),
          );
        } else if (text.includes('pg_catalog.pg_indexes')) {
          rows = [...expected.indexes].map((indexname) => ({ indexname }));
        } else {
          rows = [...expected.tables].flatMap(([table, value]) =>
            [
              ['c', value.constraints.check],
              ['f', value.constraints.foreignKey],
              ['p', value.constraints.primaryKey],
              ['u', value.constraints.unique],
            ]
              .filter(([, count]) => Number(count) > 0)
              .map(([constraint_type, count]) => ({
                table_name: table,
                constraint_type,
                count: String(count),
              })),
          );
        }
        return { rows: rows as TRow[] };
      },
    };
    await expect(
      assertOpenMaicCatalogReady(queryable, 'openmaic_draft', expected),
    ).resolves.toBeUndefined();
    expect(statements).toHaveLength(3);
    expect(statements.join('\n')).not.toMatch(/\b(?:create|alter|drop|insert|update|delete)\b/i);
  });
});
