import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryWhiteboardVisibility } from '@/lib/chat/pi/whiteboard-visibility';

const mocks = vi.hoisted(() => ({ authorizeOpenMaicRequest: vi.fn() }));

vi.mock('@/lib/reachacademy/bridge/guard', () => ({
  authorizeOpenMaicRequest: mocks.authorizeOpenMaicRequest,
}));

function request(
  body: unknown,
  headers: Record<string, string> = {
    cookie: 'reachany_openmaic_session=session-id',
    'x-openmaic-stage-id': 'stage-1',
  },
): NextRequest {
  return new Request('http://localhost/api/chat/pi/whiteboard-visibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('whiteboard visibility callback route', () => {
  beforeEach(() => {
    mocks.authorizeOpenMaicRequest.mockReset();
    mocks.authorizeOpenMaicRequest.mockResolvedValue({ grant: { learnerKey: 'learner-1' } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not let malformed, unauthenticated, or mismatched callbacks settle the owner', async () => {
    let queryId = '';
    const pending = queryWhiteboardVisibility({
      stageId: 'stage-1',
      learnerKey: 'learner-1',
      timeoutMs: 1_000,
      dispatch: async (id) => {
        queryId = id;
      },
    });
    await vi.waitFor(() => expect(queryId).not.toBe(''));
    const { POST } = await import('@/app/api/chat/pi/whiteboard-visibility/route');

    mocks.authorizeOpenMaicRequest.mockRejectedValueOnce(new Error('session invalid'));
    expect(
      (await POST(request({ queryId, stageId: 'stage-1', visibility: 'closed' }, {}))).status,
    ).toBe(401);
    expect(
      (await POST(request({ queryId, stageId: 'wrong-stage', visibility: 'closed' }))).status,
    ).toBe(404);
    expect(
      (await POST(request({ queryId, stageId: 'stage-1', visibility: 'closed', extra: true })))
        .status,
    ).toBe(400);

    expect((await POST(request({ queryId, stageId: 'stage-1', visibility: 'open' }))).status).toBe(
      204,
    );
    await expect(pending).resolves.toBe('open');
  });
});
