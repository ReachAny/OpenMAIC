import { cookies } from 'next/headers';

import { OPENMAIC_SESSION_COOKIE, type OpenMaicStageGrantV1 } from './contracts';
import type {
  OpenMaicClientCapabilities,
  OpenMaicClientGrantCapabilities,
} from './client-capabilities';
import { getOpenMaicRedisStore } from './redis';
import { isOpenMaicIdentityCurrent } from './revocation';
import { createOpenMaicSessionManager } from './session';

function clientGrant(grant: OpenMaicStageGrantV1): OpenMaicClientGrantCapabilities {
  const capabilities = grant.capabilities;
  return {
    sub: grant.sub,
    actorOrgId: grant.actorOrgId,
    contentOrgId: grant.contentOrgId,
    courseId: grant.courseId,
    stageId: grant.stageId,
    stage: grant.stage,
    role: grant.role,
    expiresAt: grant.expiresAt,
    roleOrigin: grant.roleOrigin,
    returnTo: grant.returnTo,
    documentRead: capabilities.includes('document.read'),
    documentWrite: capabilities.includes('document.write'),
    agentRead: capabilities.includes('agent.read'),
    agentWrite: capabilities.includes('agent.write'),
    modelInvoke: capabilities.includes('model.invoke'),
    modelInvokeLearner: capabilities.includes('model.invoke.learner'),
  };
}

export async function getServerOpenMaicCapabilities(): Promise<OpenMaicClientCapabilities> {
  const databaseReady = Boolean(process.env.DATABASE_URL?.trim());
  if (!databaseReady) return { databaseReady: false, grants: [] };
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(OPENMAIC_SESSION_COOKIE)?.value;
    if (!sessionId) return { databaseReady, grants: [] };
    const redis = getOpenMaicRedisStore();
    const current = await createOpenMaicSessionManager(redis).read(sessionId);
    if (!current) return { databaseReady, grants: [] };
    const now = Date.now();
    const grants: OpenMaicClientGrantCapabilities[] = [];
    for (const grant of Object.values(current.session.grants)) {
      if (grant.expiresAt <= now) continue;
      if (
        await isOpenMaicIdentityCurrent(redis, {
          sub: current.session.sub,
          family: current.session.family,
          launchIat: grant.iat,
          sessionCreatedAt: current.session.createdAt,
          now,
        })
      ) {
        grants.push(clientGrant(grant));
      }
    }
    return { databaseReady, grants };
  } catch {
    return { databaseReady, grants: [] };
  }
}
