import { putServerAssetBytes } from '@/lib/server/server-asset-bytes';

/**
 * Persist generated classroom media as a real course-scoped PG asset id.
 */
export async function persistClassroomMediaBytes(input: {
  stageId: string;
  coursePrincipal: string;
  bytes: Buffer | Uint8Array;
  mime: string;
  prefix?: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (input.signal?.aborted) throw new Error('aborted');
  return putServerAssetBytes({
    principal: input.coursePrincipal,
    bytes: input.bytes,
    mime: input.mime,
    meta: { stageId: input.stageId, source: input.prefix ?? 'generated' },
    signal: input.signal,
  });
}
