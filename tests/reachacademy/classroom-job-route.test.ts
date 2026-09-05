import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authorizeOpenMaicRequest: vi.fn(),
  checkpoint: vi.fn(),
  readClassroomGenerationJob: vi.fn(),
}));

vi.mock('@/lib/reachacademy/bridge/guard', () => ({
  authorizeOpenMaicRequest: mocks.authorizeOpenMaicRequest,
  markPrivateNoStore: (response: Response) => {
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  },
  openMaicAuthorizationResponse: () => Response.json({ error: 'denied' }, { status: 403 }),
}));
vi.mock('@/lib/reachacademy/bridge/job-authorization', () => ({
  createOpenMaicJobAuthorizationManager: () => ({ checkpoint: mocks.checkpoint }),
}));
vi.mock('@/lib/server/classroom-job-store', () => ({
  isValidClassroomJobId: (jobId: string) => /^[a-zA-Z0-9_-]+$/.test(jobId),
  readClassroomGenerationJob: mocks.readClassroomGenerationJob,
}));
vi.mock('@/lib/server/classroom-storage', () => ({
  buildRequestOrigin: () => 'https://openmaic.example',
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import { GET } from '@/app/api/generate-classroom/[jobId]/route';

function request(): NextRequest {
  return new Request('https://openmaic.example/api/generate-classroom/job-1', {
    headers: { 'x-openmaic-stage-id': 'stage-1' },
  }) as unknown as NextRequest;
}

function context() {
  return { params: Promise.resolve({ jobId: 'job-1' }) };
}

describe('GET /api/generate-classroom/[jobId]', () => {
  beforeEach(() => {
    mocks.authorizeOpenMaicRequest.mockReset();
    mocks.checkpoint.mockReset();
    mocks.readClassroomGenerationJob.mockReset();
    mocks.authorizeOpenMaicRequest.mockResolvedValue({
      sessionId: 'session-1',
      grant: { stageId: 'stage-1' },
    });
    mocks.checkpoint.mockResolvedValue({
      lease: { sessionId: 'session-1', stageId: 'stage-1' },
    });
    mocks.readClassroomGenerationJob.mockResolvedValue({
      id: 'job-1',
      status: 'running',
      step: 'outline',
      progress: 25,
      message: 'Generating',
      scenesGenerated: 1,
      totalScenes: 4,
    });
  });

  test('reads a job only after its lease matches the current session and stage', async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.checkpoint).toHaveBeenCalledWith('classroom', 'job-1');
    expect(mocks.readClassroomGenerationJob).toHaveBeenCalledWith('job-1');
  });

  test.each([
    [{ sessionId: 'other-session', stageId: 'stage-1' }],
    [{ sessionId: 'session-1', stageId: 'other-stage' }],
  ])('does not reveal a job owned by another grant', async (lease) => {
    mocks.checkpoint.mockResolvedValueOnce({ lease });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.readClassroomGenerationJob).not.toHaveBeenCalled();
  });

  test('does not reveal whether a job exists when its lease is unavailable', async () => {
    mocks.checkpoint.mockRejectedValueOnce(new Error('lease missing'));

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.readClassroomGenerationJob).not.toHaveBeenCalled();
  });
});
