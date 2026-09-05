import { describe, expect, test } from 'vitest';

import fixture from '../fixtures/openmaic-auth-bridge-v1.json';
import { parseOpenMaicLaunchGrant } from '@/lib/reachacademy/bridge/contracts';
import {
  createOpenMaicJobAuthorizationManager,
  OPENMAIC_JOB_AUTH_TTL_MS,
  openMaicJobAuthorizationDigest,
  parseOpenMaicJobAuthorization,
} from '@/lib/reachacademy/bridge/job-authorization';
import { createMemoryOpenMaicRedisStore } from '@/lib/reachacademy/bridge/redis';
import { createOpenMaicSessionManager } from '@/lib/reachacademy/bridge/session';

const teacher = parseOpenMaicLaunchGrant(fixture.teacherDraft)!;

async function setup() {
  let now = fixture.now;
  const store = createMemoryOpenMaicRedisStore(() => now);
  const sessions = createOpenMaicSessionManager(store, {
    now: () => now,
    randomId: () => 'S'.repeat(43),
  });
  const current = await sessions.createOrMerge(undefined, teacher);
  await store.setIfAbsent(
    `reachany:frontend-session:family:${teacher.family.id}`,
    JSON.stringify(fixture.familyMarker),
    Math.ceil((teacher.family.expiresAt - now) / 1_000),
  );
  const jobs = createOpenMaicJobAuthorizationManager(store, { now: () => now });
  return {
    current,
    jobs,
    setNow(value: number) {
      now = value;
    },
    store,
  };
}

describe('ReachAcademy durable job authorization', () => {
  test('creates one exact profile lease with a canonical identity digest', async () => {
    const { current, jobs } = await setup();
    const grant = current.session.grants[teacher.stageId]!;
    const lease = await jobs.create({
      sessionId: current.id,
      stageId: grant.stageId,
      jobKind: 'agent',
      jobId: 'agent-session-1',
      jobProfile: 'teacher.agent-authoring',
    });

    expect(lease.expiresAt).toBe(
      Math.min(teacher.family.expiresAt, fixture.now + OPENMAIC_JOB_AUTH_TTL_MS),
    );
    expect(lease.authorizationDigest).toBe(
      openMaicJobAuthorizationDigest(grant, current.session.family, 'teacher.agent-authoring'),
    );
    expect(parseOpenMaicJobAuthorization(lease)).toEqual(lease);
    await expect(jobs.checkpoint('agent', 'agent-session-1')).resolves.toMatchObject({
      grant: { stageId: teacher.stageId },
      lease: { jobProfile: 'teacher.agent-authoring' },
    });
  });

  test('binds role and the capability set without depending on capability order', async () => {
    const { current } = await setup();
    const grant = current.session.grants[teacher.stageId]!;
    const profile = 'teacher.agent-authoring';
    const digest = openMaicJobAuthorizationDigest(grant, current.session.family, profile);

    expect(
      openMaicJobAuthorizationDigest(
        { ...grant, capabilities: [...grant.capabilities].reverse() },
        current.session.family,
        profile,
      ),
    ).toBe(digest);
    expect(
      openMaicJobAuthorizationDigest(
        { ...grant, capabilities: grant.capabilities.filter((item) => item !== 'asset.write') },
        current.session.family,
        profile,
      ),
    ).not.toBe(digest);
    expect(
      openMaicJobAuthorizationDigest(
        { ...grant, role: 'student' },
        current.session.family,
        profile,
      ),
    ).not.toBe(digest);
  });

  test('uses the code-owned profile table and rejects kind or capability mismatches', async () => {
    const { current, jobs, store } = await setup();
    const grant = current.session.grants[teacher.stageId]!;
    await expect(
      jobs.create({
        sessionId: current.id,
        stageId: grant.stageId,
        jobKind: 'material',
        jobId: 'wrong-kind',
        jobProfile: 'teacher.agent-authoring',
      }),
    ).rejects.toMatchObject({ code: 'OPENMAIC_JOB_KIND_MISMATCH' });

    const student = parseOpenMaicLaunchGrant(fixture.studentPublished)!;
    const studentSessions = createOpenMaicSessionManager(store, {
      now: () => fixture.now,
      randomId: () => 'L'.repeat(43),
    });
    const studentSession = await studentSessions.createOrMerge(undefined, student);
    await expect(
      jobs.create({
        sessionId: studentSession.id,
        stageId: student.stageId,
        jobKind: 'material',
        jobId: 'student-material',
        jobProfile: 'teacher.material-extract',
      }),
    ).rejects.toMatchObject({ code: 'OPENMAIC_JOB_ROLE_DENIED' });
  });

  test('continues after interactive grant expiry but stops at lease expiry', async () => {
    const { current, jobs, setNow } = await setup();
    const grant = current.session.grants[teacher.stageId]!;
    const lease = await jobs.create({
      sessionId: current.id,
      stageId: grant.stageId,
      jobKind: 'classroom',
      jobId: 'classroom-1',
      jobProfile: 'teacher.classroom-generate',
    });

    setNow(grant.expiresAt + 1);
    await expect(jobs.checkpoint('classroom', 'classroom-1')).resolves.toBeTruthy();
    setNow(lease.expiresAt + 1);
    await expect(jobs.checkpoint('classroom', 'classroom-1')).rejects.toMatchObject({
      code: 'OPENMAIC_JOB_LEASE_INVALID',
    });
  });

  test('binds interactive checkpoints to the lease caller identity', async () => {
    const { current, jobs } = await setup();
    const grant = current.session.grants[teacher.stageId]!;
    await jobs.create({
      sessionId: current.id,
      stageId: grant.stageId,
      jobKind: 'export',
      jobId: 'export-1',
      jobProfile: 'teacher.video-export',
    });

    const caller = {
      sessionId: current.id,
      stageId: grant.stageId,
      sub: grant.sub,
      principal: grant.coursePrincipal,
      principalSurface: 'course' as const,
    };
    await expect(jobs.checkpoint('export', 'export-1', caller)).resolves.toBeTruthy();

    await expect(
      jobs.checkpoint('export', 'export-1', { ...caller, sessionId: `${current.id}foreign` }),
    ).rejects.toMatchObject({ code: 'OPENMAIC_JOB_CALLER_MISMATCH' });
    await expect(
      jobs.checkpoint('export', 'export-1', { ...caller, stageId: `${grant.stageId}-foreign` }),
    ).rejects.toMatchObject({ code: 'OPENMAIC_JOB_CALLER_MISMATCH' });
    await expect(
      jobs.checkpoint('export', 'export-1', { ...caller, sub: 'foreign-subject' }),
    ).rejects.toMatchObject({ code: 'OPENMAIC_JOB_CALLER_MISMATCH' });
    await expect(
      jobs.checkpoint('export', 'export-1', { ...caller, principal: 'foreign-principal' }),
    ).rejects.toMatchObject({ code: 'OPENMAIC_JOB_CALLER_MISMATCH' });
  });

  test('fails closed immediately when issuance is blocked', async () => {
    const { current, jobs, store } = await setup();
    const grant = current.session.grants[teacher.stageId]!;
    await jobs.create({
      sessionId: current.id,
      stageId: grant.stageId,
      jobKind: 'material',
      jobId: 'material-1',
      jobProfile: 'teacher.material-extract',
    });
    await store.setIfAbsent(`revoked:subject-issuance-block:{${teacher.sub}}`, 'operation', 60);
    await expect(jobs.checkpoint('material', 'material-1')).rejects.toMatchObject({
      code: 'OPENMAIC_JOB_IDENTITY_REVOKED',
    });
  });
});
