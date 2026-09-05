import {
  authorizeOpenMaicRequest,
  openMaicAuthorizationResponse,
} from '@/lib/reachacademy/bridge/guard';
import { getOpenMaicBridgeRuntime } from '@/lib/reachacademy/bridge/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'OPENMAIC_RENEW_INVALID' } }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof (body as Record<string, unknown>).stageId !== 'string'
  ) {
    return Response.json({ error: { code: 'OPENMAIC_RENEW_INVALID' } }, { status: 400 });
  }
  const stageId = (body as { stageId: string }).stageId;
  try {
    const authorization = await authorizeOpenMaicRequest(request, { stageId });
    const intent = await getOpenMaicBridgeRuntime().sessions.createRenewIntent(
      authorization.sessionId,
      stageId,
    );
    const route = authorization.grant.role === 'student' ? 'student' : 'teacher';
    const renewUrl = new URL(
      `/${route}/openmaic-renew/${encodeURIComponent(stageId)}`,
      authorization.grant.roleOrigin,
    );
    renewUrl.searchParams.set('state', intent.state);
    return Response.json(
      {
        renewUrl: renewUrl.toString(),
        state: intent.state,
        expiresAt: authorization.grant.expiresAt,
        stageId,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return openMaicAuthorizationResponse(error);
  }
}
