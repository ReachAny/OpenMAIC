'use client';

import { useOpenMaicCapabilities } from '@/lib/reachacademy/bridge/client-capabilities';
import { useStageStore } from '@/lib/store/stage';
import { useEffect, useState } from 'react';

/**
 * Where "back" goes when this course was launched by ReachAcademy.
 *
 * A hosted course has no OpenMAIC home to return to: the teacher or learner arrived from a course
 * page, and the deck list here is not theirs. The destination is read off the bridge grant, which
 * the contract already pins to the issuing role origin, so nothing here has to validate a URL.
 *
 * Returns null in a standalone deployment, or once the grant has expired — both cases where the
 * ordinary in-app exit is the right one.
 *
 * @param stageId the stage to resolve for; defaults to whatever the stage store currently holds,
 *     which is what every classroom surface wants. Pages that know a stage before the document
 *     loads (the launch entry, the Pro workspace's active course) pass it explicitly.
 */
export function useOpenMaicHostReturnUrl(stageId?: string | null): string | null {
  const openStageId = useStageStore((state) => state.stage?.id ?? null);
  const grant = useOpenMaicCapabilities(stageId ?? openStageId);
  const [storedReturnTo, setStoredReturnTo] = useState<string | null>(null);
  useEffect(() => {
    if (grant?.returnTo) return;
    try {
      const stored = JSON.parse(window.sessionStorage.getItem('openmaic:launch-context') ?? 'null');
      setStoredReturnTo(typeof stored?.returnTo === 'string' ? stored.returnTo : null);
    } catch {
      setStoredReturnTo(null);
    }
  }, [grant?.returnTo]);
  return grant?.returnTo ?? storedReturnTo;
}
