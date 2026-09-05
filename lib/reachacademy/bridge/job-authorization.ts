import { createHash } from 'node:crypto';

import {
  type OpenMaicCapability,
  type OpenMaicFamilyV1,
  type OpenMaicSessionV1,
  type OpenMaicStageGrantV1,
} from './contracts';
import type { OpenMaicPrincipalSurface } from './route-classification';
import { getOpenMaicRedisStore, type OpenMaicRedisStore } from './redis';
import { isOpenMaicIdentityCurrent } from './revocation';
import { createOpenMaicSessionManager } from './session';

export const OPENMAIC_JOB_AUTH_KEY_PREFIX = 'reachany:openmaic-job-auth:';
export const OPENMAIC_JOB_AUTH_TTL_MS = 2 * 60 * 60 * 1_000;

export const OPENMAIC_JOB_PROFILES = {
  'teacher.classroom-generate': {
    jobKind: 'classroom',
    enqueueCapabilities: ['document.write', 'asset.write', 'model.invoke'],
    mutationSurfaces: ['document', 'asset'],
  },
  'teacher.agent-authoring': {
    jobKind: 'agent',
    enqueueCapabilities: [
      'agent.write',
      'document.write',
      'asset.write',
      'material.write',
      'skill.write',
      'model.invoke',
    ],
    mutationSurfaces: ['agent', 'document', 'asset', 'material', 'skill'],
  },
  'teacher.material-extract': {
    jobKind: 'material',
    enqueueCapabilities: ['material.write', 'asset.read', 'asset.write', 'model.invoke'],
    mutationSurfaces: ['material', 'asset'],
  },
  'teacher.video-export': {
    jobKind: 'export',
    enqueueCapabilities: ['export.write', 'model.invoke'],
    mutationSurfaces: ['export'],
  },
} as const satisfies Record<
  string,
  {
    jobKind: string;
    enqueueCapabilities: readonly OpenMaicCapability[];
    mutationSurfaces: readonly string[];
  }
>;

export type OpenMaicJobProfile = keyof typeof OPENMAIC_JOB_PROFILES;
export type OpenMaicJobKind = (typeof OPENMAIC_JOB_PROFILES)[OpenMaicJobProfile]['jobKind'];

export interface OpenMaicJobAuthorizationV1 {
  v: 1;
  sessionId: string;
  stageId: string;
  jobKind: OpenMaicJobKind;
  jobId: string;
  jobProfile: OpenMaicJobProfile;
  authorizationDigest: string;
  createdAt: number;
  expiresAt: number;
}

export interface OpenMaicJobCheckpoint {
  lease: OpenMaicJobAuthorizationV1;
  session: OpenMaicSessionV1;
  grant: OpenMaicStageGrantV1;
  profile: (typeof OPENMAIC_JOB_PROFILES)[OpenMaicJobProfile];
}

/** Interactive identity that is allowed to consume a durable job lease. */
export interface OpenMaicJobAuthorizationCaller {
  sessionId: string;
  stageId: string;
  sub: string;
  principal: string;
  principalSurface: OpenMaicPrincipalSurface;
}

export class OpenMaicJobAuthorizationError extends Error {
  constructor(readonly code: string) {
    super('OpenMAIC durable job authorization denied');
    this.name = 'OpenMaicJobAuthorizationError';
  }
}

const JOB_ID = /^[A-Za-z0-9_-]{1,256}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isJobProfile(value: unknown): value is OpenMaicJobProfile {
  return typeof value === 'string' && Object.hasOwn(OPENMAIC_JOB_PROFILES, value);
}

export function openMaicJobAuthorizationKey(jobKind: OpenMaicJobKind, jobId: string): string {
  if (!JOB_ID.test(jobId)) throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_ID_INVALID');
  return `${OPENMAIC_JOB_AUTH_KEY_PREFIX}${jobKind}:${jobId}`;
}

export function parseOpenMaicJobAuthorization(value: unknown): OpenMaicJobAuthorizationV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !hasExactKeys(candidate, [
      'v',
      'sessionId',
      'stageId',
      'jobKind',
      'jobId',
      'jobProfile',
      'authorizationDigest',
      'createdAt',
      'expiresAt',
    ]) ||
    candidate.v !== 1 ||
    typeof candidate.sessionId !== 'string' ||
    !JOB_ID.test(candidate.sessionId) ||
    typeof candidate.stageId !== 'string' ||
    candidate.stageId.length === 0 ||
    candidate.stageId.length > 512 ||
    typeof candidate.jobId !== 'string' ||
    !JOB_ID.test(candidate.jobId) ||
    !isJobProfile(candidate.jobProfile) ||
    candidate.jobKind !== OPENMAIC_JOB_PROFILES[candidate.jobProfile].jobKind ||
    typeof candidate.authorizationDigest !== 'string' ||
    !DIGEST.test(candidate.authorizationDigest) ||
    !isEpoch(candidate.createdAt) ||
    !isEpoch(candidate.expiresAt) ||
    candidate.expiresAt < candidate.createdAt ||
    candidate.expiresAt - candidate.createdAt > OPENMAIC_JOB_AUTH_TTL_MS
  ) {
    return null;
  }
  return candidate as unknown as OpenMaicJobAuthorizationV1;
}

export function openMaicJobAuthorizationDigest(
  grant: OpenMaicStageGrantV1,
  family: OpenMaicFamilyV1,
  jobProfile: OpenMaicJobProfile,
): string {
  const canonical = JSON.stringify({
    sub: grant.sub,
    family: {
      id: family.id,
      version: family.version,
      expiresAt: family.expiresAt,
    },
    actorOrgId: grant.actorOrgId,
    contentOrgId: grant.contentOrgId,
    courseId: grant.courseId,
    stageId: grant.stageId,
    stage: grant.stage,
    role: grant.role,
    capabilities: [...grant.capabilities].sort(),
    coursePrincipal: grant.coursePrincipal,
    personalPrincipal: grant.personalPrincipal,
    learnerKey: grant.learnerKey,
    jobProfile,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function assertProfileGrant(
  grant: OpenMaicStageGrantV1,
  jobProfile: OpenMaicJobProfile,
  now: number,
): void {
  const profile = OPENMAIC_JOB_PROFILES[jobProfile];
  if (grant.role !== 'teacher' || grant.stage !== 'draft') {
    throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_ROLE_DENIED');
  }
  if (grant.expiresAt <= now) {
    throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_GRANT_EXPIRED');
  }
  if (!profile.enqueueCapabilities.every((capability) => grant.capabilities.includes(capability))) {
    throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_PROFILE_DENIED');
  }
}

function parseSerializedLease(serialized: string): OpenMaicJobAuthorizationV1 | null {
  try {
    return parseOpenMaicJobAuthorization(JSON.parse(serialized) as unknown);
  } catch {
    return null;
  }
}

function principalForSurface(
  grant: OpenMaicStageGrantV1,
  surface: OpenMaicPrincipalSurface,
): string {
  switch (surface) {
    case 'course':
      return grant.coursePrincipal;
    case 'personal':
      return grant.personalPrincipal;
    case 'learner':
      return grant.learnerKey;
    case 'none':
      return '';
  }
}

export function createOpenMaicJobAuthorizationManager(
  store: OpenMaicRedisStore = getOpenMaicRedisStore(),
  options: { now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const sessions = createOpenMaicSessionManager(store, { now });

  return {
    async create(input: {
      sessionId: string;
      stageId: string;
      jobKind: OpenMaicJobKind;
      jobId: string;
      jobProfile: OpenMaicJobProfile;
    }): Promise<OpenMaicJobAuthorizationV1> {
      const createdAt = now();
      const profile = OPENMAIC_JOB_PROFILES[input.jobProfile];
      if (profile.jobKind !== input.jobKind) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_KIND_MISMATCH');
      }
      const current = await sessions.read(input.sessionId);
      const grant = current?.session.grants[input.stageId];
      if (!current || !grant || current.session.sub !== grant.sub) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_SESSION_INVALID');
      }
      assertProfileGrant(grant, input.jobProfile, createdAt);
      const expiresAt = Math.min(
        current.session.family.expiresAt,
        createdAt + OPENMAIC_JOB_AUTH_TTL_MS,
      );
      if (expiresAt <= createdAt) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_FAMILY_EXPIRED');
      }
      const lease: OpenMaicJobAuthorizationV1 = {
        v: 1,
        sessionId: input.sessionId,
        stageId: grant.stageId,
        jobKind: input.jobKind,
        jobId: input.jobId,
        jobProfile: input.jobProfile,
        authorizationDigest: openMaicJobAuthorizationDigest(
          grant,
          current.session.family,
          input.jobProfile,
        ),
        createdAt,
        expiresAt,
      };
      const key = openMaicJobAuthorizationKey(input.jobKind, input.jobId);
      const serialized = JSON.stringify(lease);
      const ttl = Math.ceil((expiresAt - createdAt) / 1_000);
      if (await store.setIfAbsent(key, serialized, ttl)) return lease;
      const existing = await store.get(key);
      if (existing === serialized) return lease;
      const parsed = existing ? parseSerializedLease(existing) : null;
      if (
        parsed?.sessionId === lease.sessionId &&
        parsed.stageId === lease.stageId &&
        parsed.jobKind === lease.jobKind &&
        parsed.jobId === lease.jobId &&
        parsed.jobProfile === lease.jobProfile &&
        parsed.authorizationDigest === lease.authorizationDigest &&
        parsed.expiresAt > createdAt
      ) {
        return parsed;
      }
      throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_LEASE_EXISTS');
    },

    async checkpoint(
      jobKind: OpenMaicJobKind,
      jobId: string,
      caller?: OpenMaicJobAuthorizationCaller,
    ): Promise<OpenMaicJobCheckpoint> {
      const currentTime = now();
      const serialized = await store.get(openMaicJobAuthorizationKey(jobKind, jobId));
      const lease = serialized ? parseSerializedLease(serialized) : null;
      if (!lease || lease.jobKind !== jobKind || lease.jobId !== jobId) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_LEASE_INVALID');
      }
      if (caller && (caller.sessionId !== lease.sessionId || caller.stageId !== lease.stageId)) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_CALLER_MISMATCH');
      }
      if (lease.expiresAt <= currentTime) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_LEASE_EXPIRED');
      }
      const current = await sessions.read(lease.sessionId);
      const grant = current?.session.grants[lease.stageId];
      if (!current || !grant || current.session.sub !== grant.sub) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_SESSION_INVALID');
      }
      if (
        caller &&
        (caller.sub !== current.session.sub ||
          caller.principal !== principalForSurface(grant, caller.principalSurface))
      ) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_CALLER_MISMATCH');
      }
      const digest = openMaicJobAuthorizationDigest(
        grant,
        current.session.family,
        lease.jobProfile,
      );
      if (digest !== lease.authorizationDigest) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_AUTHORIZATION_CHANGED');
      }
      if (
        !(await isOpenMaicIdentityCurrent(store, {
          sub: current.session.sub,
          family: current.session.family,
          launchIat: grant.iat,
          sessionCreatedAt: current.session.createdAt,
          now: currentTime,
        }))
      ) {
        throw new OpenMaicJobAuthorizationError('OPENMAIC_JOB_IDENTITY_REVOKED');
      }
      return {
        lease,
        session: current.session,
        grant,
        profile: OPENMAIC_JOB_PROFILES[lease.jobProfile],
      };
    },
  };
}
