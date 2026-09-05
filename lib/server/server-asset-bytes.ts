import { toAssetId, type AssetMeta } from '@openmaic/storage';

import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { stageConnectionString } from '@/lib/persistence/stage-routing';

async function draftAssetStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('server asset persistence requires DATABASE_URL');
  return (await getServerPersistenceProvider(stageConnectionString(connectionString, 'draft')))
    .assetStore;
}

/** Persist durable bytes in the PostgreSQL asset pool under an authenticated principal. */
export async function putServerAssetBytes(input: {
  principal: string;
  bytes: Buffer | Uint8Array;
  mime: string;
  meta?: AssetMeta;
  signal?: AbortSignal;
}): Promise<string> {
  if (!input.principal) throw new Error('server asset persistence requires a principal');
  if (input.signal?.aborted) throw new Error('aborted');
  const bytes = Uint8Array.from(input.bytes);
  const store = await draftAssetStore();
  const id = await store.put({ key: input.principal }, new Blob([bytes], { type: input.mime }), {
    contentType: input.mime,
    ...input.meta,
  });
  if (input.signal?.aborted) {
    await store.remove({ key: input.principal }, id).catch(() => undefined);
    throw new Error('aborted');
  }
  return id;
}

export async function resolveServerAssetBytes(
  principal: string,
  assetId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const resolved = await (await draftAssetStore()).resolve({ key: principal }, toAssetId(assetId));
  return resolved ? { bytes: Buffer.from(resolved.bytes), mime: resolved.mime } : null;
}

export async function removeServerAssetBytes(principal: string, assetId: string): Promise<void> {
  await (await draftAssetStore()).remove({ key: principal }, toAssetId(assetId));
}
