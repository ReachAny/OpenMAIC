import { describe, expect, test } from 'vitest';

import fixture from '../fixtures/openmaic-auth-bridge-v1.json';
import {
  parseOpenMaicLaunchGrant,
  parseOpenMaicSession,
  stageGrantFromLaunch,
  STUDENT_PUBLISHED_CAPABILITIES,
} from '@/lib/reachacademy/bridge/contracts';
import {
  hasValidMutationOrigin,
  isSameOpenMaicRenewalSite,
  requestOrigin,
} from '@/lib/reachacademy/bridge/origin';

describe('ReachAcademy OpenMAIC bridge contract', () => {
  test('strictly parses the shared draft and published fixtures', () => {
    expect(parseOpenMaicLaunchGrant(fixture.teacherDraft)?.stage).toBe('draft');
    const student = parseOpenMaicLaunchGrant(fixture.studentPublished);
    expect(student?.capabilities).toEqual(STUDENT_PUBLISHED_CAPABILITIES);
    expect(student?.capabilities).not.toContain('agent.write');
    expect(stageGrantFromLaunch(student!).expiresAt).toBe(fixture.now + 15 * 60 * 1_000);
  });

  test('fails closed on capability, principal, expiry, and redirect drift', () => {
    expect(
      parseOpenMaicLaunchGrant({
        ...fixture.studentPublished,
        capabilities: [...fixture.studentPublished.capabilities, 'agent.write'],
      }),
    ).toBeNull();
    expect(
      parseOpenMaicLaunchGrant({
        ...fixture.teacherDraft,
        coursePrincipal: 'reachacademy:content-service',
      }),
    ).toBeNull();
    expect(
      parseOpenMaicLaunchGrant({ ...fixture.teacherDraft, launchExp: fixture.now + 60_001 }),
    ).toBeNull();
    expect(
      parseOpenMaicLaunchGrant({ ...fixture.teacherDraft, nextPath: '//evil.example/path' }),
    ).toBeNull();
    expect(
      parseOpenMaicLaunchGrant({
        ...fixture.teacherDraft,
        nextPath: `/workspace?course=${fixture.teacherDraft.stageId}&course=other`,
      }),
    ).toBeNull();
    expect(
      parseOpenMaicLaunchGrant({
        ...fixture.teacherDraft,
        nextPath: `/classroom/${fixture.teacherDraft.stageId}#unexpected`,
      }),
    ).toBeNull();
    expect(
      parseOpenMaicLaunchGrant({
        ...fixture.teacherDraft,
        family: { ...fixture.teacherDraft.family, version: 'not-opaque' },
      }),
    ).toBeNull();
    const grant = stageGrantFromLaunch(parseOpenMaicLaunchGrant(fixture.teacherDraft)!);
    expect(
      parseOpenMaicSession({
        version: 1,
        sub: fixture.teacherDraft.sub,
        family: fixture.teacherDraft.family,
        createdAt: fixture.teacherDraft.family.expiresAt + 1,
        expiresAt: fixture.teacherDraft.family.expiresAt,
        grants: { [grant.stageId]: grant },
      }),
    ).toBeNull();
  });

  test('requires one schemeful site and rejects localhost', () => {
    expect(
      isSameOpenMaicRenewalSite('https://teacher.reach.example', 'https://openmaic.reach.example'),
    ).toBe(true);
    expect(isSameOpenMaicRenewalSite('http://127.0.0.1:5202', 'http://127.0.0.1:3002')).toBe(true);
    expect(isSameOpenMaicRenewalSite('http://localhost:5202', 'http://localhost:3002')).toBe(false);
    expect(
      isSameOpenMaicRenewalSite('https://teacher.reach.example', 'http://openmaic.reach.example'),
    ).toBe(false);
  });

  test('derives request origin from forwarded host before Next URL fallback', () => {
    const request = new Request('http://localhost:3002/api/openmaic/exchange', {
      headers: {
        host: '127.0.0.1:3002',
        'x-forwarded-host': '127.0.0.1:3002',
        'x-forwarded-proto': 'http',
      },
    });
    expect(requestOrigin(request)).toBe('http://127.0.0.1:3002');
    request.headers.set('origin', 'http://127.0.0.1:3002');
    request.headers.set('sec-fetch-site', 'same-origin');
    Object.defineProperty(request, 'method', { value: 'POST' });
    expect(hasValidMutationOrigin(request)).toBe(true);

    const spoofed = new Request('http://localhost:3002/api/openmaic/exchange', {
      headers: {
        host: '127.0.0.1:3002',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http',
      },
    });
    expect(requestOrigin(spoofed)).toBe('http://localhost:3002');
  });
});
