'use client';

import { useCallback, useEffect, useRef } from 'react';

const RENEW_INTERVAL_MS = 30_000;
const RENEW_TIMEOUT_MS = 15_000;

type RenewMessage = { type?: unknown; ok?: unknown; stageId?: unknown };

/** Renew the server-side stage grant through the Teacher/Student same-site bridge. */
export function renewOpenMaicGrant(stageId: string, roleOrigin: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.display = 'none';
    const timer = window.setTimeout(() => finish(false), RENEW_TIMEOUT_MS);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(ok);
    };
    const onMessage = (event: MessageEvent<RenewMessage>) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== 'openmaic-renew' ||
        event.data.stageId !== stageId
      ) {
        return;
      }
      finish(event.data.ok === true);
    };
    window.addEventListener('message', onMessage);
    void (async () => {
      try {
        const response = await fetch('/api/openmaic/renew/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageId }),
        });
        if (!response.ok) return finish(false);
        const payload = (await response.json()) as { renewUrl?: unknown };
        if (typeof payload.renewUrl !== 'string' || new URL(payload.renewUrl).origin !== roleOrigin) {
          return finish(false);
        }
        frame.src = payload.renewUrl;
        document.body.append(frame);
      } catch {
        finish(false);
      }
    })();
  });
}

export function useOpenMaicGrantRenewal(
  stageId: string | null | undefined,
  roleOrigin: string | null | undefined,
  returnTo?: string | null,
) {
  const running = useRef(false);
  const failures = useRef(0);
  const renew = useCallback(async () => {
    if (!stageId || !roleOrigin || running.current) return false;
    running.current = true;
    try {
      const ok = await renewOpenMaicGrant(stageId, roleOrigin);
      failures.current = ok ? 0 : failures.current + 1;
      if (!ok && failures.current >= 2 && returnTo) window.location.assign(returnTo);
      return ok;
    } finally {
      running.current = false;
    }
  }, [returnTo, roleOrigin, stageId]);

  useEffect(() => {
    if (!stageId || !roleOrigin) return;
    void renew();
    const timer = window.setInterval(() => void renew(), RENEW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [renew, roleOrigin, stageId]);

  return renew;
}
