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

export function buildClassroomHref(
  stageId: string,
  requestedMode?: RequestedClassroomMode,
): string {
  const path = `/classroom/${encodeURIComponent(stageId)}`;
  return requestedMode === 'edit' ? `${path}?mode=edit` : path;
}

/** Published documents stay playback-only; an explicit host intent may enable gated Pro mode. */
export function isClassroomEditingEnabled({
  autoEnterEditMode,
  featureEnabled,
  published,
}: ClassroomEntryIntent & { featureEnabled: boolean }): boolean {
  return !published && (featureEnabled || autoEnterEditMode);
}
