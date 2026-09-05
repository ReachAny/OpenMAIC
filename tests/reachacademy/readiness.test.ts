import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertOpenMaicCatalogReady: vi.fn(),
  assertOpenMaicImportReady: vi.fn(),
  ping: vi.fn(),
  pools: [] as Array<{ connectionString: string; end: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@/lib/persistence/catalog-readiness', () => ({
  assertOpenMaicCatalogReady: mocks.assertOpenMaicCatalogReady,
}));
vi.mock('@/lib/persistence/import-readiness', () => ({
  assertOpenMaicImportReady: mocks.assertOpenMaicImportReady,
}));
vi.mock('@/lib/reachacademy/bridge/redis', () => ({
  getOpenMaicRedisStore: () => ({ ping: mocks.ping }),
}));
vi.mock('pg', () => ({
  Pool: class {
    connectionString: string;
    end = vi.fn().mockResolvedValue(undefined);

    constructor(options: { connectionString: string }) {
      this.connectionString = options.connectionString;
      mocks.pools.push(this);
    }
  },
}));

import { GET } from '@/app/api/ready/route';

describe('ReachAcademy readiness', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('ASSET_S3_BUCKET', '');
    mocks.assertOpenMaicCatalogReady.mockReset();
    mocks.assertOpenMaicCatalogReady.mockResolvedValue(undefined);
    mocks.assertOpenMaicImportReady.mockReset();
    mocks.assertOpenMaicImportReady.mockResolvedValue(undefined);
    mocks.ping.mockReset();
    mocks.ping.mockResolvedValue(undefined);
    mocks.pools.length = 0;
  });

  test('keeps health live while readiness fails without database configuration', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const readiness = await GET();
    const { GET: health } = await import('@/app/api/health/route');

    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toEqual({ status: 'not-ready', reason: 'database' });
    expect((await health()).status).toBe(200);
  });

  test('checks both grant-selected schemas and frontend Redis without mutating them', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://openmaic.example/openmaic');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.assertOpenMaicCatalogReady.mock.calls.map((call) => call[1])).toEqual([
      'openmaic_draft',
      'openmaic_published',
    ]);
    expect(mocks.pools.map((pool) => pool.connectionString)).toEqual([
      expect.stringContaining('search_path%3Dopenmaic_draft'),
      expect.stringContaining('search_path%3Dopenmaic_published'),
    ]);
    expect(mocks.ping).toHaveBeenCalledOnce();
    expect(mocks.assertOpenMaicImportReady).toHaveBeenCalledOnce();
    expect(mocks.pools.every((pool) => pool.end.mock.calls.length === 1)).toBe(true);
  });

  test('fails readiness but keeps health live when import evidence is incomplete', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://openmaic.example/openmaic');
    mocks.assertOpenMaicImportReady.mockRejectedValueOnce(new Error('incomplete import'));

    const readiness = await GET();
    const { GET: health } = await import('@/app/api/health/route');

    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toEqual({ status: 'not-ready', reason: 'dependency' });
    expect((await health()).status).toBe(200);
    expect(mocks.assertOpenMaicImportReady).toHaveBeenCalledOnce();
    expect(mocks.ping).not.toHaveBeenCalled();
  });

  test('fails closed before dependencies when the unsupported S3 backend is configured', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://openmaic.example/openmaic');
    vi.stubEnv('ASSET_S3_BUCKET', 'bucket');

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'not-ready', reason: 'asset-backend' });
    expect(mocks.pools).toEqual([]);
    expect(mocks.ping).not.toHaveBeenCalled();
  });
});
