import { describe, expect, test } from 'vitest';

import fixture from '../fixtures/openmaic-auth-bridge-v1.json';
import { parseOpenMaicLaunchGrant } from '@/lib/reachacademy/bridge/contracts';
import {
  authorizeOpenMaicRequest,
  OpenMaicAuthorizationError,
} from '@/lib/reachacademy/bridge/guard';
import { createMemoryOpenMaicRedisStore } from '@/lib/reachacademy/bridge/redis';
import { createOpenMaicSessionManager } from '@/lib/reachacademy/bridge/session';

async function authorizedFixture(kind: 'teacher' | 'student') {
  const launch = parseOpenMaicLaunchGrant(
    kind === 'teacher' ? fixture.teacherDraft : fixture.studentPublished,
  )!;
  const store = createMemoryOpenMaicRedisStore(() => fixture.now);
  await store.setIfAbsent(
    `reachany:frontend-session:family:${launch.family.id}`,
    JSON.stringify({ v: 1, version: launch.family.version, expiresAt: launch.family.expiresAt }),
    60,
  );
  const sessions = createOpenMaicSessionManager(store, {
    now: () => fixture.now,
    randomId: () => (kind === 'teacher' ? 'T' : 'U').repeat(43),
  });
  const current = await sessions.createOrMerge(undefined, launch);
  return { launch, store, sessionId: current.id };
}

function request(
  path: string,
  method: string,
  sessionId: string,
  stageId: string,
  csrf = true,
): Request {
  return new Request(`https://openmaic.reach.example${path}`, {
    method,
    headers: {
      cookie: `reachany_openmaic_session=${sessionId}`,
      'x-openmaic-stage-id': stageId,
      ...(csrf
        ? { origin: 'https://openmaic.reach.example', 'sec-fetch-site': 'same-origin' }
        : {}),
    },
  });
}

describe('ReachAcademy OpenMAIC request guard', () => {
  test('derives each persistence principal from the grant', async () => {
    const teacher = await authorizedFixture('teacher');
    const document = await authorizeOpenMaicRequest(
      request(
        `/api/persistence/documents/${teacher.launch.stageId}`,
        'GET',
        teacher.sessionId,
        teacher.launch.stageId,
      ),
      { store: teacher.store, now: fixture.now },
    );
    expect(document.principal).toBe(teacher.launch.coursePrincipal);

    const personal = await authorizeOpenMaicRequest(
      request('/api/materials', 'POST', teacher.sessionId, teacher.launch.stageId),
      { store: teacher.store, now: fixture.now },
    );
    expect(personal.principal).toBe(teacher.launch.personalPrincipal);
  });

  test('allows published learner runtime writes but denies document writes', async () => {
    const student = await authorizedFixture('student');
    await expect(
      authorizeOpenMaicRequest(
        request(
          '/api/persistence/runtime/sessions',
          'POST',
          student.sessionId,
          student.launch.stageId,
        ),
        { store: student.store, now: fixture.now },
      ),
    ).resolves.toMatchObject({ principal: student.launch.learnerKey });
    await expect(
      authorizeOpenMaicRequest(
        request(
          `/api/persistence/documents/${student.launch.stageId}/stage`,
          'PUT',
          student.sessionId,
          student.launch.stageId,
        ),
        { store: student.store, now: fixture.now },
      ),
    ).rejects.toMatchObject({ code: 'OPENMAIC_CAPABILITY_DENIED' });
  });

  test('requires exact same-origin CSRF evidence for mutations', async () => {
    const teacher = await authorizedFixture('teacher');
    await expect(
      authorizeOpenMaicRequest(
        request('/api/materials', 'POST', teacher.sessionId, teacher.launch.stageId, false),
        { store: teacher.store, now: fixture.now },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<OpenMaicAuthorizationError>>({
        code: 'OPENMAIC_CSRF_DENIED',
      }),
    );
    const siblingOrigin = request(
      '/api/materials',
      'POST',
      teacher.sessionId,
      teacher.launch.stageId,
    );
    siblingOrigin.headers.set('origin', 'https://teacher.reach.example');
    siblingOrigin.headers.set('sec-fetch-site', 'same-site');
    await expect(
      authorizeOpenMaicRequest(siblingOrigin, { store: teacher.store, now: fixture.now }),
    ).rejects.toMatchObject({ code: 'OPENMAIC_CSRF_DENIED' });
  });
});
