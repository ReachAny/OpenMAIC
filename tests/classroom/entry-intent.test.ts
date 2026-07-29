import { describe, expect, it } from 'vitest';

import {
  buildClassroomHref,
  isClassroomEditingEnabled,
  readRequestedClassroomMode,
  resolveClassroomEntryIntent,
} from '@/lib/classroom/entry-intent';

describe('classroom entry intent', () => {
  it('honours explicit draft authoring intent', () => {
    const params = new URLSearchParams('mode=edit');
    const intent = resolveClassroomEntryIntent(params);

    expect(intent).toEqual({ autoEnterEditMode: true, published: false });
    expect(isClassroomEditingEnabled({ ...intent, featureEnabled: false })).toBe(true);
  });

  it('forces published documents to playback even when edit is requested', () => {
    const intent = resolveClassroomEntryIntent(new URLSearchParams('stage=published&mode=edit'));

    expect(intent).toEqual({ autoEnterEditMode: false, published: true });
    expect(isClassroomEditingEnabled({ ...intent, featureEnabled: true })).toBe(false);
  });

  it('retains the feature-gated Pro toggle for ordinary draft classroom links', () => {
    const intent = resolveClassroomEntryIntent(new URLSearchParams());

    expect(isClassroomEditingEnabled({ ...intent, featureEnabled: false })).toBe(false);
    expect(isClassroomEditingEnabled({ ...intent, featureEnabled: true })).toBe(true);
  });

  it('propagates only the supported generation destination mode', () => {
    expect(readRequestedClassroomMode(new URLSearchParams('mode=edit'))).toBe('edit');
    expect(readRequestedClassroomMode(new URLSearchParams('mode=playback'))).toBeUndefined();
    expect(buildClassroomHref('stage/with slash', 'edit')).toBe(
      '/classroom/stage%2Fwith%20slash?mode=edit',
    );
    expect(buildClassroomHref('stage-id')).toBe('/classroom/stage-id');
  });
});
