import { describe, expect, test } from 'vitest';

import fixture from '../fixtures/openmaic-auth-bridge-v1.json';
import {
  parseOpenMaicLaunchGrant,
  parseOpenMaicPublishIntent,
} from '@/lib/reachacademy/bridge/contracts';
import { createLaunchGrantManager } from '@/lib/reachacademy/bridge/launch';
import {
  createMemoryOpenMaicRedisStore,
  resolveOpenMaicRedisConfiguration,
} from '@/lib/reachacademy/bridge/redis';
import { isOpenMaicIdentityCurrent, parseIsoInstant } from '@/lib/reachacademy/bridge/revocation';
import {
  createOpenMaicSessionManager,
  OPENMAIC_PUBLISH_KEY_PREFIX,
  OPENMAIC_RENEW_KEY_PREFIX,
  openMaicSessionCookie,
} from '@/lib/reachacademy/bridge/session';

const teacher = parseOpenMaicLaunchGrant(fixture.teacherDraft)!;

describe('ReachAcademy OpenMAIC Redis/session protocol', () => {
  test('preserves URL database and rejects an explicit conflict', () => {
    expect(
      resolveOpenMaicRedisConfiguration({
        REACHANY_FRONTEND_REDIS_URL: 'rediss://redis.example/4',
      }),
    ).toEqual({ kind: 'url', url: 'rediss://redis.example/4', db: 4 });
    expect(() =>
      resolveOpenMaicRedisConfiguration({
        REACHANY_FRONTEND_REDIS_URL: 'redis://redis.example/4',
        REACHANY_FRONTEND_REDIS_DB: '0',
      }),
    ).toThrow(/conflicts/);
    expect(
      resolveOpenMaicRedisConfiguration({
        REDIS_HOST: 'fallback',
        REACHANY_FRONTEND_REDIS_HOST: 'frontend',
        REACHANY_FRONTEND_EXCHANGE_REDIS_DB: '3',
      }),
    ).toMatchObject({ kind: 'plain', host: 'frontend', db: 3 });
  });

  test('consumes launch records exactly once with compare-delete', async () => {
    let now = fixture.now;
    const store = createMemoryOpenMaicRedisStore(() => now);
    const manager = createLaunchGrantManager(store, {
      now: () => now,
      randomId: () => 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    });
    const code = await manager.create(teacher);
    await expect(manager.consume(code, teacher.state)).resolves.toEqual(teacher);
    await expect(manager.consume(code, teacher.state)).resolves.toBeNull();
    now += 61_000;
    await expect(manager.consume(code, teacher.state)).resolves.toBeNull();
  });

  test('merges only the same subject and complete family without extending expiry', async () => {
    const store = createMemoryOpenMaicRedisStore(() => fixture.now);
    let id = 0;
    const sessions = createOpenMaicSessionManager(store, {
      now: () => fixture.now,
      randomId: () => `${++id}`.padEnd(43, 'S'),
    });
    const first = await sessions.createOrMerge(undefined, teacher);
    const secondLaunch = parseOpenMaicLaunchGrant({
      ...fixture.teacherDraft,
      stageId: 'stage-two',
      nextPath: '/classroom/stage-two',
    })!;
    const merged = await sessions.createOrMerge(first.id, secondLaunch);
    expect(merged.id).toBe(first.id);
    expect(Object.keys(merged.session.grants).sort()).toEqual(['stage-draft', 'stage-two']);
    expect(merged.session.expiresAt).toBe(first.session.expiresAt);

    const rotated = await sessions.createOrMerge(first.id, {
      ...teacher,
      family: { ...teacher.family, version: 'rotated' },
    });
    expect(rotated.id).not.toBe(first.id);
    expect(Object.keys(rotated.session.grants)).toEqual(['stage-draft']);
  });

  test('sets Secure only for HTTPS', () => {
    expect(
      openMaicSessionCookie('D'.repeat(43), teacher.family.expiresAt, 'http://127.0.0.1:3002'),
    ).not.toContain('Secure');
    expect(
      openMaicSessionCookie('D'.repeat(43), teacher.family.expiresAt, 'https://openmaic.example'),
    ).toContain('Secure');
  });

  test('consumes a renewal intent exactly once and rejects a mismatched stored state', async () => {
    const store = createMemoryOpenMaicRedisStore(() => fixture.now);
    let id = 0;
    const sessions = createOpenMaicSessionManager(store, {
      now: () => fixture.now,
      randomId: () => `${++id}`.padEnd(43, 'R'),
    });
    const current = await sessions.createOrMerge(undefined, teacher);
    const intent = await sessions.createRenewIntent(current.id, teacher.stageId);
    await expect(sessions.consumeRenewIntent(intent.state)).resolves.toEqual(intent);
    await expect(sessions.consumeRenewIntent(intent.state)).resolves.toBeNull();

    const mismatchedKey = 'M'.repeat(43);
    await store.setIfAbsent(
      `${OPENMAIC_RENEW_KEY_PREFIX}${mismatchedKey}`,
      JSON.stringify({ ...intent, state: 'N'.repeat(43) }),
      60,
    );
    await expect(sessions.consumeRenewIntent(mismatchedKey)).resolves.toBeNull();
  });

  /**
   * The publish intent is the capability the Teacher app redeems, so it must be mintable only
   * from a live teacher draft grant, live under its own key, and read back as a publish intent.
   */
  test('mints publish intents only for a teacher draft grant, under their own key', async () => {
    const store = createMemoryOpenMaicRedisStore(() => fixture.now);
    let id = 0;
    const sessions = createOpenMaicSessionManager(store, {
      now: () => fixture.now,
      randomId: () => `${++id}`.padEnd(43, 'P'),
    });
    const current = await sessions.createOrMerge(undefined, teacher);
    const intent = await sessions.createPublishIntent(current.id, teacher.stageId);

    expect(intent.role).toBe('teacher');
    const stored = await store.get(`${OPENMAIC_PUBLISH_KEY_PREFIX}${intent.state}`);
    expect(parseOpenMaicPublishIntent(JSON.parse(stored!))).toEqual(intent);
    // Distinct namespaces: redeeming one must never consume the other.
    await expect(store.get(`${OPENMAIC_RENEW_KEY_PREFIX}${intent.state}`)).resolves.toBeNull();
    await expect(sessions.consumeRenewIntent(intent.state)).resolves.toBeNull();

    // A read-only published grant is not a weaker publish permission; it is none.
    const published = parseOpenMaicLaunchGrant(fixture.studentPublished)!;
    const learner = await sessions.createOrMerge(undefined, published);
    await expect(sessions.createPublishIntent(learner.id, published.stageId)).rejects.toThrow(
      /teacher draft grant/,
    );
    await expect(sessions.createPublishIntent(current.id, 'stage-unknown')).rejects.toThrow(
      /unavailable/,
    );
  });

  test('mirrors cutoff precision and family/issuance-block revocation', async () => {
    expect(parseIsoInstant('1787918399999000')).toBe(BigInt('1787918399999000000'));
    expect(parseIsoInstant('2026-08-28T12:00:00.123456789Z')).toBe(BigInt('1787918400123456789'));
    const store = createMemoryOpenMaicRedisStore(() => fixture.now);
    await store.setIfAbsent(
      `reachany:frontend-session:family:${teacher.family.id}`,
      JSON.stringify(fixture.familyMarker),
      60,
    );
    expect(
      await isOpenMaicIdentityCurrent(store, {
        sub: teacher.sub,
        family: teacher.family,
        launchIat: teacher.iat,
        sessionCreatedAt: teacher.iat,
        now: fixture.now,
      }),
    ).toBe(true);
    await store.setIfAbsent(
      `revoked:subject:{${teacher.sub}}`,
      '2026-08-28T11:59:59.999999999Z',
      60,
    );
    expect(
      await isOpenMaicIdentityCurrent(store, {
        sub: teacher.sub,
        family: teacher.family,
        launchIat: teacher.iat,
        sessionCreatedAt: teacher.iat,
        now: fixture.now,
      }),
    ).toBe(true);
    await store.setIfAbsent(`revoked:subject-issuance-block:{${teacher.sub}}`, 'operation', 60);
    expect(
      await isOpenMaicIdentityCurrent(store, {
        sub: teacher.sub,
        family: teacher.family,
        launchIat: teacher.iat,
        sessionCreatedAt: teacher.iat,
        now: fixture.now,
      }),
    ).toBe(false);
  });
});
