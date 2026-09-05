import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { ensureAgentSessionSchema } from '@openmaic/storage/agent-session/pg';
import { ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { ensureDocumentSchema } from '@openmaic/storage/document/pg';
import { ensureAgentSessionMaterialSchema } from '@openmaic/storage/material/pg';
import { ensureSchema as ensureRuntimeSchema } from '@openmaic/storage/runtime/pg';
import { ensureUserSkillSchema } from '@openmaic/storage/skill/pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { ensureOwnerMaterialSchema } from '@/lib/persistence/owner-materials';
import { createOwnerBoundDocumentStore } from '@/lib/persistence/owner-bound-document-store';
import { stageConnectionString } from '@/lib/persistence/stage-routing';
import { ensureStageMetaSchema, StageAccessError } from '@/lib/persistence/stage-meta';

class PGlitePool {
  constructor(readonly db: PGlite) {}

  query(text: string, params?: unknown[]) {
    return this.db.query(text, params);
  }

  async connect() {
    return {
      query: (text: string, params?: unknown[]) => this.db.query(text, params),
      release() {},
    };
  }

  async end() {
    await this.db.close();
  }
}

function courseDocument(id: string, name = 'Agent course') {
  const now = 1_800_000_000_000;
  return {
    stage: { id, name, createdAt: now, updatedAt: now },
    scenes: [],
    outline: {
      outlines: [],
      requirement: name,
      generationComplete: false,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function ownerStore(pool: PGlitePool, ownerId: string) {
  return createOwnerBoundDocumentStore({
    pool,
    ownerId,
    validateScene: validateAppScene,
    validateStage: validateAppStage,
  });
}

/** A single row read back from stage_meta after a delete. */
interface StageMetaTombstoneRow {
  deleted_at: string | Date | null;
}

describe('reference-fidelity stage access', () => {
  let pool: PGlitePool;
  const ownerCookie = '11111111-1111-4111-8111-111111111111';
  const visitorCookie = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', `postgres://stage-access-${randomUUID()}`);
    vi.stubEnv('ASSET_S3_BUCKET', '');
    const db = new PGlite();
    await db.waitReady;
    await db.query('CREATE SCHEMA openmaic_draft');
    await db.query('SET search_path TO openmaic_draft');
    await ensureAssetSchema(db);
    await ensureDocumentSchema(db);
    await ensureRuntimeSchema(db);
    await ensureAgentSessionSchema(db);
    await ensureAgentSessionMaterialSchema(db);
    await ensureUserSkillSchema(db);
    await ensureStageMetaSchema(db);
    await ensureOwnerMaterialSchema(db);
    pool = new PGlitePool(db);
    vi.doMock('@/lib/reachacademy/bridge/guard', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/reachacademy/bridge/guard')>()),
      authorizeOpenMaicRequest: vi.fn(async (request: Request) => {
        const stageId = decodeURIComponent(new URL(request.url).pathname.split('/documents/')[1]!);
        const cookie = request.headers.get('cookie') ?? '';
        const coursePrincipal = cookie.includes(visitorCookie)
          ? `anon:${visitorCookie}`
          : `anon:${ownerCookie}`;
        return {
          grant: {
            stageId,
            stage: 'draft',
            coursePrincipal,
            learnerKey: `${coursePrincipal}:learner`,
          },
        };
      }),
    }));
  });

  afterEach(async () => {
    await pool.end();
    vi.unstubAllEnvs();
  });

  it('loads an agent-created stage through the browser path using the same owner cookie', async () => {
    const connectionString = stageConnectionString(process.env.DATABASE_URL!, 'draft');
    const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const provider = await getServerPersistenceProvider(connectionString, () => pool as never);
    const stageId = 'stage-agent-browser-regression';
    await ownerStore(pool, `anon:${ownerCookie}`).saveDocument(courseDocument(stageId));

    const { handlePersistenceRequest } = await import('@/app/api/persistence/[...path]/route');
    const response = await handlePersistenceRequest(
      new Request(`http://localhost/api/persistence/documents/${stageId}`, {
        headers: { cookie: `anonymous_id=${ownerCookie}` },
      }),
      { poolFactory: () => pool as never },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ stage: { id: stageId } });
    expect(provider.pool).toBe(pool);
  });

  it('allows capability reads, refuses foreign writes, and filters the owner library', async () => {
    const connectionString = stageConnectionString(process.env.DATABASE_URL!, 'draft');
    const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    await getServerPersistenceProvider(connectionString, () => pool as never);
    const stageId = 'stage-capability-policy';
    const owner = ownerStore(pool, `anon:${ownerCookie}`);
    const visitor = ownerStore(pool, `anon:${visitorCookie}`);
    await owner.saveDocument(courseDocument(stageId));

    await expect(visitor.loadDocument(stageId)).resolves.toMatchObject({ stage: { id: stageId } });
    await expect(
      visitor.saveDocument(courseDocument(stageId, 'Foreign edit')),
    ).rejects.toBeInstanceOf(StageAccessError);
    const { handlePersistenceRequest } = await import('@/app/api/persistence/[...path]/route');
    const visitorRead = await handlePersistenceRequest(
      new Request(`http://localhost/api/persistence/documents/${stageId}`, {
        headers: { cookie: `anonymous_id=${visitorCookie}` },
      }),
      { poolFactory: () => pool as never },
    );
    expect(visitorRead.status).toBe(200);
    await expect(visitorRead.json()).resolves.toMatchObject({ stage: { id: stageId } });

    const foreignWrite = await handlePersistenceRequest(
      new Request(`http://localhost/api/persistence/documents/${stageId}`, {
        method: 'PUT',
        headers: {
          cookie: `anonymous_id=${visitorCookie}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(courseDocument(stageId, 'Foreign edit')),
      }),
      { poolFactory: () => pool as never },
    );
    expect(foreignWrite.status).toBe(403);
    await expect(foreignWrite.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN_DOCUMENTS' },
    });

    await expect(owner.listDocuments()).resolves.toEqual([
      expect.objectContaining({ id: stageId }),
    ]);
    await expect(visitor.listDocuments()).resolves.toEqual([]);
  });

  it('tombstones deletions and permanently retires the stage id', async () => {
    const connectionString = stageConnectionString(process.env.DATABASE_URL!, 'draft');
    const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    await getServerPersistenceProvider(connectionString, () => pool as never);
    const stageId = 'stage-retired-id';
    const owner = ownerStore(pool, `anon:${ownerCookie}`);
    await owner.saveDocument(courseDocument(stageId));
    await owner.deleteDocument(stageId);

    await expect(owner.loadDocument(stageId)).resolves.toBeNull();
    await expect(
      owner.saveDocument(courseDocument(stageId, 'Resurrection')),
    ).rejects.toBeInstanceOf(StageAccessError);
    const rows = await pool.query(
      `SELECT meta.deleted_at
         FROM stage_meta AS meta
         JOIN document_stages AS stages ON stages.id = meta.stage_id
        WHERE meta.stage_id = $1`,
      [stageId],
    );
    expect((rows.rows[0] as StageMetaTombstoneRow | undefined)?.deleted_at).not.toBeNull();
  });
});
