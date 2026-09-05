'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { renewOpenMaicGrant } from './use-openmaic-renewal';

/**
 * The Teacher app performs the publication, so the result has to travel back across an origin.
 *
 * A hidden iframe plus `postMessage` is how the bridge already does this for grant renewal: it
 * needs no CORS, no credentialed cross-origin fetch, and the teacher never leaves the editor.
 */
export interface OpenMaicPublishResult {
  /** `false` when the draft was unchanged and the existing version was returned. */
  published: boolean;
  sceneCount: number;
  versionNo: number;
}

export type OpenMaicPublishState = 'idle' | 'running' | 'done' | 'error';

export interface OpenMaicPublishController {
  publish: () => void;
  reset: () => void;
  result: OpenMaicPublishResult | null;
  state: OpenMaicPublishState;
}

/**
 * A publication is a handful of cross-schema copies, not a generation job. Fifteen seconds is
 * generous for it and short enough that a silently blocked iframe surfaces as a failure the
 * teacher can retry, rather than a spinner that never resolves.
 */
const PUBLISH_TIMEOUT_MS = 15_000;

function isPublishMessage(data: unknown): data is { type: 'openmaic-publish'; ok: boolean } & {
  published?: unknown;
  sceneCount?: unknown;
  versionNo?: unknown;
} {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'openmaic-publish' &&
    typeof (data as { ok?: unknown }).ok === 'boolean'
  );
}

/**
 * Publish the given draft stage through the Teacher app.
 *
 * `roleOrigin` comes from the bridge grant, not from configuration or the message itself, so the
 * result is only accepted from the exact origin this session was launched by.
 */
export function useOpenMaicPublish(
  stageId: string | null | undefined,
  roleOrigin: string | null | undefined,
): OpenMaicPublishController {
  const [state, setState] = useState<OpenMaicPublishState>('idle');
  const [result, setResult] = useState<OpenMaicPublishResult | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // The iframe and its listener outlive the async call that created them, so unmounting mid-flight
  // must tear both down or the frame keeps a detached document alive.
  useEffect(() => () => cleanupRef.current?.(), []);

  const reset = useCallback(() => {
    cleanupRef.current?.();
    setState('idle');
    setResult(null);
  }, []);

  const publish = useCallback(() => {
    if (!stageId || !roleOrigin) return;
    cleanupRef.current?.();
    setResult(null);
    setState('running');

    let settled = false;
    let frame: HTMLIFrameElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const teardown = () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame?.remove();
      frame = null;
      cleanupRef.current = null;
    };
    const settle = (next: OpenMaicPublishState, value: OpenMaicPublishResult | null) => {
      if (settled) return;
      settled = true;
      teardown();
      setResult(value);
      setState(next);
    };

    function onMessage(event: MessageEvent) {
      // The grant's own role origin — never the message's claim about itself.
      if (event.origin !== roleOrigin || !isPublishMessage(event.data)) return;
      if (!event.data.ok) return settle('error', null);
      settle('done', {
        published: event.data.published === true,
        sceneCount: typeof event.data.sceneCount === 'number' ? event.data.sceneCount : 0,
        versionNo: typeof event.data.versionNo === 'number' ? event.data.versionNo : 0,
      });
    }

    cleanupRef.current = teardown;
    window.addEventListener('message', onMessage);
    timer = setTimeout(() => settle('error', null), PUBLISH_TIMEOUT_MS);

    void (async () => {
      try {
        // Generation and editing can outlive the original 60-second exchange grant. Re-authorize
        // immediately before minting the one-time publish intent so a long-running page cannot
        // publish with an expired capability.
        if (!(await renewOpenMaicGrant(stageId, roleOrigin))) return settle('error', null);
        const response = await fetch('/api/openmaic/publish/start', {
          body: JSON.stringify({ stageId }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        if (!response.ok) return settle('error', null);
        const payload = (await response.json()) as { publishUrl?: unknown };
        if (typeof payload.publishUrl !== 'string') return settle('error', null);
        // Belt and braces: the URL is built server-side from the grant, and checked again here so
        // a compromised response cannot make this page load a third-party document.
        if (new URL(payload.publishUrl).origin !== roleOrigin) return settle('error', null);
        if (settled) return;
        frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.display = 'none';
        frame.src = payload.publishUrl;
        document.body.append(frame);
      } catch {
        settle('error', null);
      }
    })();
  }, [roleOrigin, stageId]);

  return { publish, reset, result, state };
}
