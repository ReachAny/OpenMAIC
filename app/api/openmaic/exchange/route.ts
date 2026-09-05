import { OPENMAIC_SESSION_COOKIE } from '@/lib/reachacademy/bridge/contracts';
import { sameFamily } from '@/lib/reachacademy/bridge/contracts';
import { isSameOpenMaicRenewalSite, requestOrigin } from '@/lib/reachacademy/bridge/origin';
import { isOpenMaicIdentityCurrent } from '@/lib/reachacademy/bridge/revocation';
import { getOpenMaicBridgeRuntime } from '@/lib/reachacademy/bridge/runtime';
import { openMaicSessionCookie, readCookie } from '@/lib/reachacademy/bridge/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function denied(): Response {
  return Response.json(
    { error: { code: 'OPENMAIC_EXCHANGE_DENIED', message: 'launch denied' } },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  try {
    const bridge = getOpenMaicBridgeRuntime();
    const launch = await bridge.launches.consume(code, state, async (candidate) => {
      const originValid = isSameOpenMaicRenewalSite(candidate.roleOrigin, origin);
      const identityValid =
        originValid &&
        (await isOpenMaicIdentityCurrent(bridge.redis, {
          sub: candidate.sub,
          family: candidate.family,
          launchIat: candidate.iat,
        }));
      if (!originValid || !identityValid) {
        console.warn('[OpenMAIC bridge] launch rejected', {
          reason: !originValid ? 'origin' : 'identity',
          requestOrigin: origin,
          roleOrigin: candidate.roleOrigin,
        });
      }
      return originValid && identityValid;
    });
    if (!launch) return denied();
    const existingSessionId = readCookie(request.headers.get('cookie'), OPENMAIC_SESSION_COOKIE);
    let mergeSessionId: string | undefined;
    if (existingSessionId) {
      const existing = await bridge.sessions.read(existingSessionId);
      if (
        existing &&
        existing.session.sub === launch.sub &&
        sameFamily(existing.session.family, launch.family) &&
        (await isOpenMaicIdentityCurrent(bridge.redis, {
          sub: launch.sub,
          family: launch.family,
          launchIat: launch.iat,
          sessionCreatedAt: existing.session.createdAt,
        }))
      ) {
        mergeSessionId = existingSessionId;
      }
    }
    const current = await bridge.sessions.createOrMerge(mergeSessionId, launch);
    return new Response(null, {
      status: 303,
      headers: {
        'Cache-Control': 'no-store',
        Location: new URL(launch.nextPath, origin).toString(),
        'Set-Cookie': openMaicSessionCookie(current.id, current.session.expiresAt, origin),
      },
    });
  } catch {
    return denied();
  }
}
