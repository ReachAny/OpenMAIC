import { sameFamily } from '@/lib/reachacademy/bridge/contracts';
import { isSameOpenMaicRenewalSite, requestOrigin } from '@/lib/reachacademy/bridge/origin';
import { isOpenMaicIdentityCurrent } from '@/lib/reachacademy/bridge/revocation';
import { getOpenMaicBridgeRuntime } from '@/lib/reachacademy/bridge/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function html(ok: boolean, origin: string, stageId?: string): Response {
  const payload = JSON.stringify({ type: 'openmaic-renew', ok, ...(stageId ? { stageId } : {}) });
  const target = JSON.stringify(origin);
  const body = `<!doctype html><meta charset="utf-8"><script>parent.postMessage(${payload},${target});</script>`;
  return new Response(body, {
    status: ok ? 200 : 403,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  try {
    const bridge = getOpenMaicBridgeRuntime();
    const launch = await bridge.launches.consume(code, state, async (candidate) => {
      return (
        isSameOpenMaicRenewalSite(candidate.roleOrigin, origin) &&
        (await isOpenMaicIdentityCurrent(bridge.redis, {
          sub: candidate.sub,
          family: candidate.family,
          launchIat: candidate.iat,
        }))
      );
    });
    if (!launch) return html(false, origin);
    const intent = await bridge.sessions.consumeRenewIntent(state);
    if (
      !intent ||
      intent.sub !== launch.sub ||
      intent.stageId !== launch.stageId ||
      intent.role !== launch.role ||
      !sameFamily(intent.family, launch.family) ||
      JSON.stringify(intent.authorizationRef) !== JSON.stringify(launch.authorizationRef)
    ) {
      return html(false, origin);
    }
    const current = await bridge.sessions.read(intent.sessionId);
    if (
      !current ||
      current.session.sub !== intent.sub ||
      !sameFamily(current.session.family, intent.family)
    ) {
      return html(false, origin);
    }
    const replacement = await bridge.sessions.replaceGrant(
      intent.sessionId,
      current.session,
      launch,
    );
    return replacement ? html(true, origin, launch.stageId) : html(false, origin);
  } catch {
    return html(false, origin);
  }
}
