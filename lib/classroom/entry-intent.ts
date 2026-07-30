export type RequestedClassroomMode = 'edit';

interface SearchParamsReader {
  get(name: string): string | null;
}

export interface ClassroomEntryIntent {
  autoEnterEditMode: boolean;
  published: boolean;
}

/** Resolve presentation intent without treating a URL parameter as authorization. */
export function resolveClassroomEntryIntent(
  searchParams: SearchParamsReader,
): ClassroomEntryIntent {
  const published = searchParams.get('stage') === 'published';
  return {
    autoEnterEditMode: !published && searchParams.get('mode') === 'edit',
    published,
  };
}

export function readRequestedClassroomMode(
  searchParams: SearchParamsReader,
): RequestedClassroomMode | undefined {
  return searchParams.get('mode') === 'edit' ? 'edit' : undefined;
}

/** Accept only ReachAcademy Portal URLs; never turn return navigation into an open redirect. */
export function validateReachAcademyReturnUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }

  if (url.username || url.password) return undefined;

  const localHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  const validLocal = localHost && url.protocol === 'http:' && url.port === '5199';
  const validDeployment =
    url.protocol === 'https:' &&
    url.port === '' &&
    (url.hostname === 'reachany.cn' || url.hostname.endsWith('.reachany.cn'));

  return validLocal || validDeployment ? url.href : undefined;
}

export function readReachAcademyReturnUrl(searchParams: SearchParamsReader): string | undefined {
  return validateReachAcademyReturnUrl(searchParams.get('returnTo'));
}

export function resolveReachAcademyReturnUrl(
  searchParams: SearchParamsReader,
  referrer?: string,
): string | undefined {
  return readReachAcademyReturnUrl(searchParams) ?? validateReachAcademyReturnUrl(referrer);
}

export function buildClassroomHref(
  stageId: string,
  requestedMode?: RequestedClassroomMode,
  returnTo?: string,
): string {
  const path = `/classroom/${encodeURIComponent(stageId)}`;
  const params = new URLSearchParams();
  if (requestedMode === 'edit') params.set('mode', 'edit');
  if (returnTo) params.set('returnTo', returnTo);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Published documents stay playback-only; an explicit host intent may enable gated Pro mode. */
export function isClassroomEditingEnabled({
  autoEnterEditMode,
  featureEnabled,
  published,
}: ClassroomEntryIntent & { featureEnabled: boolean }): boolean {
  return !published && (featureEnabled || autoEnterEditMode);
}
