import {
  authorizeOpenMaicRequest,
  openMaicAuthorizationResponse,
  type AuthorizedOpenMaicRequest,
} from '@/lib/reachacademy/bridge/guard';
import { classifyOpenMaicApiRoute } from '@/lib/reachacademy/bridge/route-classification';

function stageIdFromRequest(req: Pick<Request, 'url' | 'method' | 'headers'>): string | undefined {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'api') return undefined;
  if (segments[1] === 'stages' && segments[2]) return decodeURIComponent(segments[2]);
  if (segments[1] === 'stage-meta' && segments[2]) return decodeURIComponent(segments[2]);
  if (segments[1] === 'classroom-media' && segments[2]) return decodeURIComponent(segments[2]);
  return undefined;
}

/** Run a legacy owner-scoped handler under the authoritative stage grant. */
export async function withRequestOwnerId(
  req: Pick<Request, 'url' | 'method' | 'headers'>,
  handler: (
    ownerId: string,
    responseHeaders: Headers,
    authorization: AuthorizedOpenMaicRequest,
  ) => Promise<Response>,
): Promise<Response> {
  const responseHeaders = new Headers();
  const classification = classifyOpenMaicApiRoute(new URL(req.url).pathname, req.method);
  try {
    const authorization = await authorizeOpenMaicRequest(req as Request, {
      classification,
      stageId: stageIdFromRequest(req),
      allowAnyStageGrant: stageIdFromRequest(req) === undefined,
    });
    return await handler(authorization.principal, responseHeaders, authorization);
  } catch (error) {
    if (error instanceof Error && error.name === 'OpenMaicAuthorizationError') {
      return openMaicAuthorizationResponse(error);
    }
    console.error('[agent-runtime] request failed under the OpenMAIC bridge', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'request failed' } },
      { status: 500, headers: responseHeaders },
    );
  }
}
