import {
  OPENMAIC_SESSION_COOKIE,
  type OpenMaicCapability,
  type OpenMaicSessionV1,
  type OpenMaicStageGrantV1,
} from './contracts';
import { hasValidMutationOrigin } from './origin';
import { getOpenMaicRedisStore, type OpenMaicRedisStore } from './redis';
import { isOpenMaicIdentityCurrent } from './revocation';
import {
  classifyOpenMaicApiRoute,
  type OpenMaicPrincipalSurface,
  type OpenMaicRouteClassification,
} from './route-classification';
import { createOpenMaicSessionManager, readCookie } from './session';

export interface AuthorizedOpenMaicRequest {
  sessionId: string;
  session: OpenMaicSessionV1;
  grant: OpenMaicStageGrantV1;
  classification: Extract<OpenMaicRouteClassification, { auth: 'session' }>;
  principal: string;
}

export class OpenMaicAuthorizationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('OpenMAIC request denied');
    this.name = 'OpenMaicAuthorizationError';
  }
}

function selectedPrincipal(grant: OpenMaicStageGrantV1, surface: OpenMaicPrincipalSurface): string {
  switch (surface) {
    case 'course':
      return grant.coursePrincipal;
    case 'personal':
      return grant.personalPrincipal;
    case 'learner':
      return grant.learnerKey;
    case 'none':
      return '';
  }
}

function hasAlternative(
  capabilities: readonly OpenMaicCapability[],
  alternatives: readonly (readonly OpenMaicCapability[])[],
): boolean {
  return alternatives.some((required) => required.every((item) => capabilities.includes(item)));
}

export async function authorizeOpenMaicRequest(
  request: Request,
  options: {
    stageId?: string | null;
    store?: OpenMaicRedisStore;
    classification?: OpenMaicRouteClassification | null;
    now?: number;
    allowAnyStageGrant?: boolean;
  } = {},
): Promise<AuthorizedOpenMaicRequest> {
  const pathname = new URL(request.url).pathname;
  const classification =
    options.classification ?? classifyOpenMaicApiRoute(pathname, request.method);
  if (!classification || classification.auth !== 'session') {
    throw new OpenMaicAuthorizationError(403, 'OPENMAIC_ROUTE_DENIED');
  }
  if (!hasValidMutationOrigin(request)) {
    throw new OpenMaicAuthorizationError(403, 'OPENMAIC_CSRF_DENIED');
  }
  const sessionId = readCookie(request.headers.get('cookie'), OPENMAIC_SESSION_COOKIE);
  if (!sessionId) throw new OpenMaicAuthorizationError(401, 'OPENMAIC_SESSION_REQUIRED');
  const store = options.store ?? getOpenMaicRedisStore();
  const current = await createOpenMaicSessionManager(store, {
    now: () => options.now ?? Date.now(),
  }).read(sessionId);
  if (!current) throw new OpenMaicAuthorizationError(401, 'OPENMAIC_SESSION_INVALID');
  const now = options.now ?? Date.now();
  const stageId = options.stageId ?? request.headers.get('x-openmaic-stage-id');
  const grant = stageId
    ? current.session.grants[stageId]
    : options.allowAnyStageGrant
      ? Object.values(current.session.grants)
          .filter((candidate) => candidate.expiresAt > now)
          .toSorted((left, right) => right.iat - left.iat)[0]
      : undefined;
  if (!stageId && !options.allowAnyStageGrant) {
    throw new OpenMaicAuthorizationError(400, 'OPENMAIC_STAGE_REQUIRED');
  }
  if (!grant || grant.expiresAt <= now) {
    throw new OpenMaicAuthorizationError(403, 'OPENMAIC_GRANT_INVALID');
  }
  const stageHint = request.headers.get('x-openmaic-stage');
  if (stageHint !== null && stageHint !== grant.stage) {
    throw new OpenMaicAuthorizationError(403, 'OPENMAIC_STAGE_MISMATCH');
  }
  if (classification.roles && !classification.roles.includes(grant.role)) {
    throw new OpenMaicAuthorizationError(403, 'OPENMAIC_ROLE_DENIED');
  }
  if (classification.stages && !classification.stages.includes(grant.stage)) {
    throw new OpenMaicAuthorizationError(403, 'OPENMAIC_COPY_DENIED');
  }
  if (!hasAlternative(grant.capabilities, classification.capabilityAlternatives)) {
    throw new OpenMaicAuthorizationError(403, 'OPENMAIC_CAPABILITY_DENIED');
  }
  if (
    !(await isOpenMaicIdentityCurrent(store, {
      sub: current.session.sub,
      family: current.session.family,
      launchIat: grant.iat,
      sessionCreatedAt: current.session.createdAt,
      now,
    }))
  ) {
    throw new OpenMaicAuthorizationError(401, 'OPENMAIC_IDENTITY_REVOKED');
  }
  return {
    sessionId,
    session: current.session,
    grant,
    classification,
    principal: selectedPrincipal(grant, classification.principal),
  };
}

export function openMaicAuthorizationResponse(error: unknown): Response {
  if (error instanceof OpenMaicAuthorizationError) {
    return Response.json(
      { error: { code: error.code, message: 'request denied' } },
      { status: error.status },
    );
  }
  return Response.json(
    { error: { code: 'OPENMAIC_AUTH_UNAVAILABLE', message: 'request denied' } },
    { status: 503 },
  );
}

export function markPrivateNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
