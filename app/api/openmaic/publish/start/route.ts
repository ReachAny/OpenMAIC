import {
  authorizeOpenMaicRequest,
  openMaicAuthorizationResponse,
} from '@/lib/reachacademy/bridge/guard';
import { getOpenMaicBridgeRuntime } from '@/lib/reachacademy/bridge/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start a publication for one draft stage.
 *
 * OpenMAIC cannot publish by itself: publication copies the draft into the immutable published
 * schema, which needs the teacher's own credentials, and the bridge deliberately never gives
 * OpenMAIC any. What it can do is prove — from its own server-side session — that this teacher
 * currently holds a writable draft grant for this stage. That proof is minted here as a one-time
 * intent and handed to the Teacher app, which redeems it, re-authorizes, and performs the write.
 *
 * The browser only ever sees the opaque state and the URL to load; it cannot forge either.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'OPENMAIC_PUBLISH_INVALID' } }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof (body as Record<string, unknown>).stageId !== 'string'
  ) {
    return Response.json({ error: { code: 'OPENMAIC_PUBLISH_INVALID' } }, { status: 400 });
  }
  const stageId = (body as { stageId: string }).stageId;
  try {
    const authorization = await authorizeOpenMaicRequest(request, { stageId });
    const intent = await getOpenMaicBridgeRuntime().sessions.createPublishIntent(
      authorization.sessionId,
      stageId,
    );
    const publishUrl = new URL(
      `/teacher/openmaic-publish/${encodeURIComponent(stageId)}`,
      authorization.grant.roleOrigin,
    );
    publishUrl.searchParams.set('state', intent.state);
    return Response.json(
      { publishUrl: publishUrl.toString(), state: intent.state, stageId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return openMaicAuthorizationResponse(error);
  }
}
