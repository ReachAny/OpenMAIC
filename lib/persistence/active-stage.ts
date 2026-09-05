/**
 * Which stage the current page is acting on, read from its own URL.
 *
 * Deliberately side-effect free and dependency free: `bootstrap.ts` configures
 * the storage seams at module evaluation time, so anything that only needs the
 * active stage — the generation flow's API headers, for instance — must be able
 * to import this without also booting persistence.
 */

/**
 * Four shapes carry the stage id:
 *
 *   /classroom/:stageId                the classic standalone classroom
 *   /workspace?course=…                the Pro workbench's active course pane
 *   /?stageId=…&mode=edit              the ReachAcademy launch entry
 *   /generation-preview?stageId=…      the generation flow that entry hands off to
 *
 * Every stage-scoped request needs this context so the server can select the
 * matching grant. Without it `/api/persistence` correctly fails closed with
 * OPENMAIC_STAGE_REQUIRED and the work is left only in memory, and the
 * generation routes silently fall back to whichever grant was issued last.
 *
 * Returns null off the browser, or on a page that carries no stage at all.
 */
export function readActiveStageIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const pathMatch = /^\/classroom\/([^/]+)$/.exec(window.location.pathname);
  const fromLocation =
    params.get('stageId') ??
    params.get('course') ??
    (pathMatch ? decodeURIComponent(pathMatch[1]) : null);
  if (fromLocation) return fromLocation;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem('openmaic:launch-context') ?? 'null');
    return typeof stored?.stageId === 'string' && stored.stageId.length > 0 ? stored.stageId : null;
  } catch {
    return null;
  }
}

/**
 * The stage header for a stage-scoped API call, or an empty object when the
 * page carries no stage. Absent rather than empty: an empty header value would
 * be a stage id of `''`, which no grant can match.
 */
export function activeStageHeaders(): Record<string, string> {
  const stageId = readActiveStageIdFromLocation();
  return stageId ? { 'x-openmaic-stage-id': stageId } : {};
}
