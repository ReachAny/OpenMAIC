import { Pool } from 'pg';

import { assertOpenMaicCatalogReady } from '@/lib/persistence/catalog-readiness';
import { stageConnectionString } from '@/lib/persistence/stage-routing';
import { getOpenMaicRedisStore } from '@/lib/reachacademy/bridge/redis';
import { assertOpenMaicImportReady } from '@/lib/persistence/import-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

export async function GET(): Promise<Response> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return Response.json(
      { status: 'not-ready', reason: 'database' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (process.env.ASSET_S3_BUCKET?.trim()) {
    return Response.json(
      { status: 'not-ready', reason: 'asset-backend' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const pools: Pool[] = [];
  try {
    for (const stage of ['draft', 'published'] as const) {
      const pool = new Pool({
        connectionString: stageConnectionString(connectionString, stage),
        max: 1,
      });
      pools.push(pool);
      await assertOpenMaicCatalogReady(pool, `openmaic_${stage}`);
    }
    await assertOpenMaicImportReady();
    await getOpenMaicRedisStore().ping();
    return Response.json({ status: 'ready' }, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { status: 'not-ready', reason: 'dependency' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  } finally {
    await Promise.all(pools.map((pool) => pool.end().catch(() => {})));
  }
}
