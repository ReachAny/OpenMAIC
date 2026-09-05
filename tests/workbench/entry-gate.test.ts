import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerOpenMaicCapabilities: vi.fn(),
}));

vi.mock('@/lib/reachacademy/bridge/server-capabilities', () => ({
  getServerOpenMaicCapabilities: mocks.getServerOpenMaicCapabilities,
}));

import { isWorkbenchEntryEnabled } from '@/lib/workbench/entry-gate';

describe('workbench entry gate', () => {
  beforeEach(() => {
    mocks.getServerOpenMaicCapabilities.mockReset();
    mocks.getServerOpenMaicCapabilities.mockResolvedValue({ databaseReady: true, grants: [] });
  });

  it('stays closed without a verified draft authoring grant', async () => {
    await expect(isWorkbenchEntryEnabled()).resolves.toBe(false);
  });

  it('opens for a server-verified draft authoring grant', async () => {
    mocks.getServerOpenMaicCapabilities.mockResolvedValue({
      databaseReady: true,
      grants: [
        {
          stage: 'draft',
          documentWrite: true,
          agentRead: true,
          modelInvoke: true,
        },
      ],
    });

    await expect(isWorkbenchEntryEnabled()).resolves.toBe(true);
  });

  it('requires the requested course to match the draft grant', async () => {
    mocks.getServerOpenMaicCapabilities.mockResolvedValue({
      databaseReady: true,
      grants: [
        {
          stageId: 'course-a',
          stage: 'draft',
          documentWrite: true,
          agentRead: true,
          modelInvoke: true,
        },
      ],
    });

    await expect(isWorkbenchEntryEnabled('course-b')).resolves.toBe(false);
    await expect(isWorkbenchEntryEnabled('course-a')).resolves.toBe(true);
  });

  it('does not accept a published or read-only grant', async () => {
    mocks.getServerOpenMaicCapabilities.mockResolvedValue({
      databaseReady: true,
      grants: [
        {
          stage: 'published',
          documentWrite: false,
          agentRead: true,
          modelInvoke: true,
        },
      ],
    });

    await expect(isWorkbenchEntryEnabled()).resolves.toBe(false);
  });
});
