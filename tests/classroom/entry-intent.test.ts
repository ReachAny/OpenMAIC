import { describe, expect, it } from 'vitest';

import {
  buildClassroomHref,
  isClassroomEditingEnabled,
  readReachAcademyReturnUrl,
  readRequestedClassroomMode,
  resolveReachAcademyReturnUrl,
  resolveClassroomEntryIntent,
  validateReachAcademyReturnUrl,
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

  it('keeps the validated Portal return URL through generation', () => {
    const returnTo = 'http://127.0.0.1:5199/teacher/courses?course=course-1#modules';

    expect(readReachAcademyReturnUrl(new URLSearchParams({ returnTo }))).toBe(returnTo);
    expect(buildClassroomHref('stage-id', 'edit', returnTo)).toBe(
      `/classroom/stage-id?mode=edit&returnTo=${encodeURIComponent(returnTo)}`,
    );
    expect(
      readReachAcademyReturnUrl(
        new URLSearchParams({ returnTo: 'https://portal.test.reachany.cn/teacher' }),
      ),
    ).toBe('https://portal.test.reachany.cn/teacher');
    expect(validateReachAcademyReturnUrl('http://localhost:5199/student/today')).toBe(
      'http://localhost:5199/student/today',
    );
  });

  it.each([
    'https://evil.example/teacher',
    'https://reachany.cn.evil.example/teacher',
    'http://portal.test.reachany.cn/teacher',
    'http://127.0.0.1:3002/',
    'http://user:secret@127.0.0.1:5199/teacher',
    'not-a-url',
  ])('rejects an unsafe Portal return URL: %s', (returnTo) => {
    expect(readReachAcademyReturnUrl(new URLSearchParams({ returnTo }))).toBeUndefined();
  });

  it('prefers an explicit return URL and otherwise accepts a Portal referrer', () => {
    const explicit = 'http://127.0.0.1:5199/teacher/courses/course-id?tab=modules';
    const referrer = 'http://localhost:5199/teacher';

    expect(
      resolveReachAcademyReturnUrl(new URLSearchParams({ returnTo: explicit }), referrer),
    ).toBe(explicit);
    expect(resolveReachAcademyReturnUrl(new URLSearchParams(), referrer)).toBe(referrer);
  });
});
