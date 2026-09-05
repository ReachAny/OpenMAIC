import { getServerOpenMaicCapabilities } from '@/lib/reachacademy/bridge/server-capabilities';

/** Server-authoritative decision shared by every workbench entry route. */
export async function isWorkbenchEntryEnabled(courseId?: string | null): Promise<boolean> {
  const capabilities = await getServerOpenMaicCapabilities();
  return capabilities.grants.some(
    (grant) =>
      (!courseId || grant.stageId === courseId) &&
      grant.stage === 'draft' &&
      grant.documentWrite &&
      grant.agentRead &&
      grant.modelInvoke,
  );
}
