import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ enabled: false, calls: [] as unknown[][] }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
}));

vi.mock('next/navigation', () => navigation);
vi.mock('@/lib/workbench/entry-gate', () => ({
  isWorkbenchEntryEnabled: (...args: unknown[]) => {
    state.calls.push(args);
    return state.enabled;
  },
}));
vi.mock('@/components/workbench/WorkspaceEntry', () => ({
  WorkspaceEntry: () => null,
}));
vi.mock('@/app/workbench/new/client', () => ({
  WorkbenchLaunchBridge: () => null,
}));

import WorkbenchNewCompatibilityPage from '@/app/workbench/new/page';
import WorkspacePage from '@/app/workspace/page';
import { WorkspaceAccessDenied } from '@/app/workspace/access-denied';

describe('workbench entry routes', () => {
  beforeEach(() => {
    state.enabled = false;
    state.calls = [];
    navigation.redirect.mockClear();
    navigation.notFound.mockClear();
  });

  it('renders a visible access error instead of a blank shell when disabled', async () => {
    const page = await WorkspacePage({ searchParams: Promise.resolve({ course: 'course-a' }) });
    expect(page.type).toBe(WorkspaceAccessDenied);
    expect(state.calls).toEqual([['course-a']]);
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it('does not expose the legacy launch bridge when disabled', async () => {
    await expect(WorkbenchNewCompatibilityPage()).rejects.toThrow('not-found');
    expect(navigation.notFound).toHaveBeenCalledOnce();
  });

  it('renders both entry routes when the shared gate is enabled', async () => {
    state.enabled = true;
    expect((await WorkspacePage()).type).not.toBe(WorkspaceAccessDenied);
    expect(WorkbenchNewCompatibilityPage()).toBeTruthy();
    expect(navigation.redirect).not.toHaveBeenCalled();
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});
