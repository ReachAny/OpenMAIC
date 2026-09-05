import { beforeEach, describe, expect, test, vi } from 'vitest';

import fixture from '../fixtures/openmaic-auth-bridge-v1.json';
import {
  parseOpenMaicLaunchGrant,
  type OpenMaicSessionV1,
} from '@/lib/reachacademy/bridge/contracts';

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  read: vi.fn(),
  createOrMerge: vi.fn(),
  identityCurrent: vi.fn(),
}));

vi.mock('@/lib/reachacademy/bridge/runtime', () => ({
  getOpenMaicBridgeRuntime: () => ({
    redis: {},
    launches: { consume: mocks.consume },
    sessions: { read: mocks.read, createOrMerge: mocks.createOrMerge },
  }),
}));

vi.mock('@/lib/reachacademy/bridge/revocation', () => ({
  isOpenMaicIdentityCurrent: mocks.identityCurrent,
}));

vi.mock('@/lib/reachacademy/bridge/origin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reachacademy/bridge/origin')>(
    '@/lib/reachacademy/bridge/origin',
  );
  return { ...actual, isSameOpenMaicRenewalSite: () => true };
});

const launch = parseOpenMaicLaunchGrant(fixture.teacherDraft)!;
const existingSession: OpenMaicSessionV1 = {
  version: 1,
  sub: launch.sub,
  family: launch.family,
  createdAt: launch.iat,
  expiresAt: launch.family.expiresAt,
  grants: {},
};

function request(cookie?: string): Request {
  return new Request(
    `http://127.0.0.1:3002/api/openmaic/exchange?code=${'C'.repeat(43)}&state=${launch.state}`,
    { headers: { host: '127.0.0.1:3002', ...(cookie ? { cookie } : {}) } },
  );
}

describe('OpenMAIC exchange session handoff', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.consume.mockResolvedValue(launch);
    mocks.identityCurrent.mockResolvedValue(true);
    mocks.createOrMerge.mockResolvedValue({
      id: 'N'.repeat(43),
      session: existingSession,
    });
  });

  test('merges a current same-family session', async () => {
    mocks.read.mockResolvedValue({
      serialized: JSON.stringify(existingSession),
      session: existingSession,
    });
    const { GET } = await import('@/app/api/openmaic/exchange/route');
    await GET(request(`reachany_openmaic_session=${'S'.repeat(43)}`));
    expect(mocks.createOrMerge).toHaveBeenCalledWith('S'.repeat(43), launch);
    expect(mocks.identityCurrent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionCreatedAt: launch.iat }),
    );
  });

  test('creates a fresh session when the existing session is revoked', async () => {
    mocks.read.mockResolvedValue({
      serialized: JSON.stringify(existingSession),
      session: existingSession,
    });
    mocks.identityCurrent.mockResolvedValue(false);
    const { GET } = await import('@/app/api/openmaic/exchange/route');
    await GET(request(`reachany_openmaic_session=${'S'.repeat(43)}`));
    expect(mocks.createOrMerge).toHaveBeenCalledWith(undefined, launch);
  });

  test('creates a fresh session when no cookie is present', async () => {
    const { GET } = await import('@/app/api/openmaic/exchange/route');
    await GET(request());
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.createOrMerge).toHaveBeenCalledWith(undefined, launch);
  });
});
