/**
 * Server-side resolution of a client-allocated asset id for extraction.
 *
 * Compatibility read fallback for callers that already hold an allocated
 * server asset id. New app flows do not allocate registry assets, but retained
 * documents and SDK clients may still name an existing entry.
 *
 * The resolution answers in five states so the route can map each to an honest
 * HTTP status: not configured (no `DATABASE_URL`), unauthenticated (the
 * bridge session or stage grant is invalid), missing (no entry
 * under this id for this principal), too large (the recorded byte length
 * exceeds the caller-supplied cap, rejected before any bytes are read), or
 * resolved.
 */
import { AssetNotFoundError, toAssetId, type AssetPrincipal } from '@openmaic/storage';

import { getServerPersistenceProvider } from './server-provider';
import { stageConnectionString } from './stage-routing';
import { authorizeOpenMaicRequest } from '@/lib/reachacademy/bridge/guard';

export type ServerAssetResolution =
  | { status: 'resolved'; buffer: Buffer; mimeType: string }
  | { status: 'unconfigured' }
  | { status: 'unauthenticated' }
  | { status: 'missing' }
  | { status: 'too_large' };

/**
 * Resolve an allocated asset id to its bytes for extraction.
 *
 * When `maxByteLength` is supplied, the store's identity read (`identify` —
 * the same call HEAD uses, carrying the recorded byte length without reading
 * the bytes) is consulted first: an asset whose recorded length exceeds the
 * cap answers `too_large` WITHOUT ever materializing the bytes, so a
 * multi-hundred-MB asset cannot be pulled into server memory just to be
 * rejected. The caller keeps its post-resolve length check as a defensive
 * backstop against a store whose recorded length disagrees with the bytes.
 */
export async function resolveServerAsset(
  assetId: string,
  headers: Headers,
  maxByteLength?: number,
): Promise<ServerAssetResolution> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { status: 'unconfigured' };

  let authorization;
  try {
    authorization = await authorizeOpenMaicRequest(
      new Request('http://openmaic.internal/api/persistence/assets', { headers }),
    );
  } catch {
    return { status: 'unauthenticated' };
  }
  const assetPrincipal: AssetPrincipal = {
    key: authorization.grant.coursePrincipal,
    learnerKey: authorization.grant.learnerKey,
  };

  try {
    const provider = await getServerPersistenceProvider(
      stageConnectionString(connectionString, authorization.grant.stage),
    );
    const ref = toAssetId(assetId);
    // Size check BEFORE materialization: `identify` reads only the registry
    // row (recorded byte length), never the bytes, so an oversized asset is
    // rejected without ever pulling it into server memory.
    if (maxByteLength !== undefined) {
      const identity = await provider.assetStore.identify(assetPrincipal, ref);
      if (!identity) return { status: 'missing' };
      if (identity.byteLength > maxByteLength) return { status: 'too_large' };
    }
    const resolved = await provider.assetStore.resolve(assetPrincipal, ref);
    if (!resolved) return { status: 'missing' };
    return { status: 'resolved', buffer: Buffer.from(resolved.bytes), mimeType: resolved.mime };
  } catch (error) {
    // An unknown id and another principal's id both miss; the registry raises
    // the same typed error for the shapes it rejects, so map it to `missing`
    // rather than leaking it as a 500.
    if (error instanceof AssetNotFoundError) return { status: 'missing' };
    throw error;
  }
}
