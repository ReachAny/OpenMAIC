import { PgAssetStore } from '@openmaic/storage/asset/pg';
import { PgDocumentStore } from '@openmaic/storage/document/pg';
import { PgRuntimeStore } from '@openmaic/storage/runtime/pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { Pool } from 'pg';

import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { lazyAssetByteStore } from '@/lib/persistence/asset-byte-store';
import { assertOpenMaicCatalogReady } from '@/lib/persistence/catalog-readiness';
import { schemaFromStageConnectionString } from '@/lib/persistence/stage-routing';
import { APP_RUNTIME_PAYLOAD_VALIDATORS } from '@/lib/runtime/payload-validators';

export type PersistencePoolFactory = (connectionString: string) => Pool;

export interface ServerPersistenceProvider {
  pool: Pool;
  runtimeStore: PgRuntimeStore;
  documentStore: PgDocumentStore;
  assetStore: PgAssetStore;
}

interface ProviderState {
  providers: Map<string, Promise<ServerPersistenceProvider>>;
}

const PROVIDER_STATE_KEY = Symbol.for('openmaic.persistence.provider');
const globalState = globalThis as typeof globalThis & {
  [key: symbol]: ProviderState | undefined;
};
const providerState = (globalState[PROVIDER_STATE_KEY] ??= { providers: new Map() });

async function createServerPersistenceProvider(
  connectionString: string,
  poolFactory: PersistencePoolFactory,
): Promise<ServerPersistenceProvider> {
  const pool = poolFactory(connectionString);
  const queryable = pool as unknown as ConnectableQueryable;
  try {
    const schema = schemaFromStageConnectionString(connectionString);
    if (!schema) throw new Error('OpenMAIC persistence requires an explicit grant-derived schema');
    if (process.env.ASSET_S3_BUCKET?.trim()) {
      throw new Error('ReachAcademy stage persistence does not support ASSET_S3_BUCKET');
    }
    await assertOpenMaicCatalogReady(queryable, schema);
    const withTransaction = nodePostgresTransaction(queryable);
    const byteStore = lazyAssetByteStore(process.env.ASSET_S3_BUCKET, queryable);
    return {
      pool,
      runtimeStore: new PgRuntimeStore(queryable, {
        withTransaction,
        payloadValidators: APP_RUNTIME_PAYLOAD_VALIDATORS,
      }),
      documentStore: new PgDocumentStore(queryable, {
        withTransaction,
        validateScene: validateAppScene,
        validateStage: validateAppStage,
      }),
      assetStore: new PgAssetStore(queryable, { withTransaction, byteStore }),
    };
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}

/** Shared server bootstrap used by both HTTP persistence and Pi composition. */
export function getServerPersistenceProvider(
  connectionString: string,
  poolFactory: PersistencePoolFactory = (value) => new Pool({ connectionString: value }),
): Promise<ServerPersistenceProvider> {
  const existing = providerState.providers.get(connectionString);
  if (existing) return existing;

  const initialization = createServerPersistenceProvider(connectionString, poolFactory).catch(
    (error) => {
      if (providerState.providers.get(connectionString) === initialization) {
        providerState.providers.delete(connectionString);
      }
      throw error;
    },
  );
  providerState.providers.set(connectionString, initialization);
  return initialization;
}

export async function closeServerPersistenceProviders(): Promise<void> {
  const providers = [...providerState.providers.values()];
  providerState.providers.clear();
  await Promise.all(
    providers.map(async (provider) => {
      const resolved = await provider.catch(() => null);
      await resolved?.pool.end().catch(() => {});
    }),
  );
}
