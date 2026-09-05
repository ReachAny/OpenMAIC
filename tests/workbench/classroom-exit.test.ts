import { describe, expect, it, vi } from 'vitest';
import {
  classroomEntryHref,
  classroomExitLabelKey,
  exitClassroom,
  resolveClassroomExit,
} from '@/lib/workbench/classroom-exit';

const params = (query = '') => new URLSearchParams(query);

describe('resolveClassroomExit', () => {
  it('returns to the workspace for an explicit workspace source', () => {
    expect(resolveClassroomExit({ searchParams: params('from=workspace') })).toEqual({
      kind: 'push',
      href: '/workspace',
    });
  });

  it('goes home for a classic classroom even when browser history exists', () => {
    // The previous history entry is often an entry-time flow (generation-preview)
    // that must never be a return target, so the classic arrow always pushes home.
    expect(resolveClassroomExit({ searchParams: params() })).toEqual({ kind: 'push', href: '/' });
  });

  it('falls back to home for a direct link such as /shared/<token>', () => {
    expect(resolveClassroomExit({ searchParams: params() })).toEqual({ kind: 'push', href: '/' });
  });

  it('prioritizes an explicit workspace source over everything else', () => {
    expect(resolveClassroomExit({ searchParams: params('from=workspace') })).toEqual({
      kind: 'push',
      href: '/workspace',
    });
  });

  it('returns to home explicitly instead of reopening Pro through browser history', () => {
    expect(resolveClassroomExit({ searchParams: params('returnTo=home') })).toEqual({
      kind: 'push',
      href: '/',
    });
  });

  /**
   * A ReachAcademy-launched course has no OpenMAIC home behind it — this deck list is not the
   * visitor's. The `returnTo=home` sentinel keeps its own meaning: it is an in-app instruction
   * from Pro playback, not a host URL, and the two never collide.
   */
  it('leaves the app for a hosted course, below an explicit workspace source', () => {
    const host = 'https://teacher.reachany.cn/teacher/courses/course-1';
    expect(resolveClassroomExit({ searchParams: params(), hostReturnUrl: host })).toEqual({
      kind: 'host',
      href: host,
    });
    expect(
      resolveClassroomExit({ searchParams: params('returnTo=home'), hostReturnUrl: host }),
    ).toEqual({ kind: 'host', href: host });
    expect(
      resolveClassroomExit({ searchParams: params('from=workspace'), hostReturnUrl: host }),
    ).toEqual({ kind: 'push', href: '/workspace' });
    // An expired or absent grant falls back to the ordinary in-app exit.
    expect(resolveClassroomExit({ searchParams: params(), hostReturnUrl: null })).toEqual({
      kind: 'push',
      href: '/',
    });
  });
});

describe('exitClassroom', () => {
  it('pushes the resolved destination and never uses browser history', () => {
    const router = { push: vi.fn() };

    exitClassroom(router, params());

    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('returns to the workspace for a workspace-attached classroom', () => {
    const router = { push: vi.fn() };

    exitClassroom(router, params('from=workspace'));

    expect(router.push).toHaveBeenCalledWith('/workspace');
  });

  it('leaves the app with a document navigation for a hosted course', () => {
    const router = { push: vi.fn() };
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    try {
      exitClassroom(router, params(), 'https://teacher.reachany.cn/teacher/courses/course-1');
    } finally {
      vi.unstubAllGlobals();
    }

    // The Next router cannot serve another origin, so this must not be a client-side push.
    expect(router.push).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('https://teacher.reachany.cn/teacher/courses/course-1');
  });
});

describe('classroom navigation metadata', () => {
  it('marks workspace entries and leaves classic entries unchanged', () => {
    expect(classroomEntryHref('course-1', true)).toBe('/classroom/course-1?from=workspace');
    expect(classroomEntryHref('course-1', false)).toBe('/classroom/course-1');
  });

  it('uses workspace copy instead of home copy for workspace exits', () => {
    expect(classroomExitLabelKey(params('from=workspace'))).toBe(
      'workbench.common.backToWorkspace',
    );
    expect(classroomExitLabelKey(params())).toBe('generation.backToHome');
  });

  it('names the course rather than a home the visitor does not have', () => {
    const host = 'https://teacher.reachany.cn/teacher/courses/course-1';
    expect(classroomExitLabelKey(params(), host)).toBe('workbench.launch.openMaicBack');
    expect(classroomExitLabelKey(params('from=workspace'), host)).toBe(
      'workbench.common.backToWorkspace',
    );
  });
});
