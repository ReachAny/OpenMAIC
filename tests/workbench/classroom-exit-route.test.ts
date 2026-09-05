import { describe, expect, it } from 'vitest';

import {
  classroomModeFromSearchParams,
  standaloneClassroomHref,
} from '@/lib/workbench/classroom-exit';

describe('Pro → standalone classroom route', () => {
  it('keeps the active stage and edit intent when leaving an edit pane', () => {
    expect(standaloneClassroomHref('stage/with spaces', false)).toBe(
      '/classroom/stage%2Fwith%20spaces?mode=edit',
    );
  });

  it('keeps the active stage and playback intent when leaving learning mode', () => {
    expect(standaloneClassroomHref('stage-1', true)).toBe('/classroom/stage-1?mode=playback');
  });

  it('falls back home when there is no active stage', () => {
    expect(standaloneClassroomHref('   ', false)).toBe('/');
  });

  it('accepts only explicit classroom chrome modes', () => {
    expect(classroomModeFromSearchParams(new URLSearchParams('mode=edit'))).toBe('edit');
    expect(classroomModeFromSearchParams(new URLSearchParams('mode=playback'))).toBe('playback');
    expect(classroomModeFromSearchParams(new URLSearchParams('mode=autonomous'))).toBeNull();
    expect(classroomModeFromSearchParams(new URLSearchParams())).toBeNull();
  });
});
