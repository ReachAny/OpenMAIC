export type ClassroomExitDecision =
  | { readonly kind: 'push'; readonly href: '/workspace' | '/' }
  /** Leave the app entirely, back to the ReachAcademy page that launched this course. */
  | { readonly kind: 'host'; readonly href: string };

interface ClassroomExitContext {
  readonly searchParams: Pick<URLSearchParams, 'get'>;
  /**
   * The host return URL from the bridge grant, when this classroom was launched by ReachAcademy.
   *
   * It comes from server-side state rather than the URL — the grant contract already guarantees it
   * is an absolute URL on the issuing role origin — so this can be navigated to without further
   * checks, and a standalone deployment simply has none.
   */
  readonly hostReturnUrl?: string | null;
}

interface ClassroomExitRouter {
  readonly push: (href: string) => void;
}

/**
 * Resolve where a standalone classroom should exit without depending on
 * browser globals, so direct links and SSR callers get the same safe default.
 *
 * A classic classroom always exits to home. The previous history entry is
 * often an entry-time flow (generation-preview) that is not a return target —
 * backing into it shows a dead "no generation in progress" page — so browser
 * history is never used for the classic arrow, which is labeled "back to
 * home" anyway. Only workbench-attached classrooms get a different
 * destination, via their explicit URL contract (`from=workspace` /
 * `returnTo=home`).
 */
export function resolveClassroomExit({
  searchParams,
  hostReturnUrl,
}: ClassroomExitContext): ClassroomExitDecision {
  // An explicit source wins over history: classroom state changes may push
  // intermediate entries onto the stack, while `from` survives refreshes and
  // does not depend on browser-specific history behaviour.
  if (searchParams.get('from') === 'workspace') {
    return { kind: 'push', href: '/workspace' };
  }
  // A hosted course has no OpenMAIC home to go back to — the teacher or learner
  // arrived from ReachAcademy and the deck list here is not theirs. Ranked below
  // `from=workspace` because that names a surface INSIDE this launch, which the
  // user has not finished with yet.
  if (hostReturnUrl) {
    return { kind: 'host', href: hostReturnUrl };
  }
  // Leaving Pro playback opens the ordinary classroom with an explicit home
  // return contract. Browser history still contains the Pro workspace, so
  // without this rule the home arrow would contradict the workspace link.
  if (searchParams.get('returnTo') === 'home') {
    return { kind: 'push', href: '/' };
  }
  return { kind: 'push', href: '/' };
}

/** Resolve against the current browser, then perform the selected exit. */
export function exitClassroom(
  router: ClassroomExitRouter,
  searchParams: Pick<URLSearchParams, 'get'>,
  hostReturnUrl?: string | null,
): void {
  const decision = resolveClassroomExit({ searchParams, hostReturnUrl });
  // A host return leaves this application, so it is a document navigation and
  // not a client-side route change the Next router could serve.
  if (decision.kind === 'host') {
    globalThis.location.assign(decision.href);
    return;
  }
  router.push(decision.href);
}

export function classroomExitLabelKey(
  searchParams: Pick<URLSearchParams, 'get'>,
  hostReturnUrl?: string | null,
): 'workbench.common.backToWorkspace' | 'workbench.launch.openMaicBack' | 'generation.backToHome' {
  if (searchParams.get('from') === 'workspace') return 'workbench.common.backToWorkspace';
  if (hostReturnUrl) return 'workbench.launch.openMaicBack';
  return 'generation.backToHome';
}

export function classroomEntryHref(stageId: string, discoverOnly: boolean): string {
  const href = `/classroom/${stageId}`;
  return discoverOnly ? `${href}?from=workspace` : href;
}

/**
 * Build the standalone classroom URL used when the Pro workspace is closed.
 * The course id is part of the route (rather than only a workspace query
 * parameter), and the transient chrome mode is explicit so a Pro edit pane
 * does not silently turn into the home page or a playback-only classroom.
 */
export function standaloneClassroomHref(stageId: string, playback: boolean): string {
  const id = encodeURIComponent(stageId.trim());
  if (!id) return '/';
  return `/classroom/${id}?mode=${playback ? 'playback' : 'edit'}`;
}

/** Read the only classroom chrome modes that are safe to request from a URL. */
export function classroomModeFromSearchParams(
  searchParams: Pick<URLSearchParams, 'get'>,
): 'edit' | 'playback' | null {
  const mode = searchParams.get('mode');
  return mode === 'edit' || mode === 'playback' ? mode : null;
}
