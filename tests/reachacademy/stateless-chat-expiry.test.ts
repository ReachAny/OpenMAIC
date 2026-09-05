import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authorizeOpenMaicRequest: vi.fn(),
  resolveModel: vi.fn(),
  statelessGenerate: vi.fn(),
}));

vi.mock('@/lib/reachacademy/bridge/guard', () => ({
  authorizeOpenMaicRequest: mocks.authorizeOpenMaicRequest,
  openMaicAuthorizationResponse: () => Response.json({ error: 'denied' }, { status: 403 }),
}));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModel: mocks.resolveModel }));
vi.mock('@/lib/ai/providers', () => ({ isProviderKeyRequired: () => false }));
vi.mock('@/lib/orchestration/stateless-generate', () => ({
  statelessGenerate: mocks.statelessGenerate,
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

import { POST } from '@/app/api/chat/route';

function request(): NextRequest {
  return new Request('https://openmaic.example/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-openmaic-stage-id': 'stage-1' },
    body: JSON.stringify({
      messages: [],
      storeState: { stage: { id: 'stage-1' } },
      config: { agentIds: ['teacher'] },
    }),
  }) as unknown as NextRequest;
}

describe('POST /api/chat grant expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.authorizeOpenMaicRequest.mockReset();
    mocks.resolveModel.mockReset();
    mocks.statelessGenerate.mockReset();
    mocks.authorizeOpenMaicRequest.mockResolvedValue({
      grant: { expiresAt: Date.now() + 100 },
    });
    mocks.resolveModel.mockResolvedValue({
      model: { id: 'test-model' },
      providerId: 'managed',
    });
    mocks.statelessGenerate.mockImplementation((_body: unknown, signal: AbortSignal) =>
      (async function* () {
        await new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      })(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('writes the authorization expiry frame before closing the stream', async () => {
    const response = await POST(request());
    const responseBody = response.text();

    await vi.advanceTimersByTimeAsync(100);

    await expect(responseBody).resolves.toBe(
      `data: ${JSON.stringify({ type: 'error', data: { message: 'authorization_expired' } })}\n\n`,
    );
  });
});
