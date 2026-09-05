import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// No feature-flags mock: the probe reads the REAL environment, so each row
// below exercises the actual `isAgentRuntimeConfigured()` /
// `isAgentRuntimeEnabled()` predicates. The suite runs without `.env.local`
// (see tests/setup-env.ts), so "no DATABASE_URL in the environment at all"
// is the default state here.
import { GET } from '@/app/api/agent/runtime/route';

const ENV_KEYS = ['OPENMAIC_AGENT_RUNTIME_ENABLED', 'DATABASE_URL'] as const;

describe('agent runtime probe', () => {
  const originals = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originals.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = originals.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    originals.clear();
  });

  it.each([
    ['DATABASE_URL is absent', undefined, undefined, false],
    ['the retired flag is set without DATABASE_URL', 'true', undefined, false],
    ['DATABASE_URL is set without the retired flag', undefined, 'postgres://runtime', true],
    ['DATABASE_URL is set with the retired flag off', 'false', 'postgres://runtime', true],
  ])('reports %s as database readiness %s', async (_case, runtimeFlag, databaseUrl, ready) => {
    if (runtimeFlag !== undefined) process.env.OPENMAIC_AGENT_RUNTIME_ENABLED = runtimeFlag;
    if (databaseUrl !== undefined) process.env.DATABASE_URL = databaseUrl;

    await expect((await GET()).json()).resolves.toEqual({
      enabled: ready,
      runtimeEnabled: ready,
    });
  });
});
