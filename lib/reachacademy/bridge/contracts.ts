export const OPENMAIC_LAUNCH_TTL_SECONDS = 60;
export const OPENMAIC_GRANT_TTL_MS = 15 * 60 * 1_000;
export const OPENMAIC_RENEW_TTL_SECONDS = 60;
export const OPENMAIC_SESSION_COOKIE = 'reachany_openmaic_session';

export const OPENMAIC_CAPABILITIES = [
  'document.read',
  'document.write',
  'asset.read',
  'asset.write',
  'runtime.read',
  'runtime.write',
  'agent.read',
  'agent.write',
  'material.read',
  'material.write',
  'skill.read',
  'skill.write',
  'folder.read',
  'folder.write',
  'model.invoke',
  'model.invoke.learner',
  'export.read',
  'export.write',
] as const;

export type OpenMaicCapability = (typeof OPENMAIC_CAPABILITIES)[number];
export type OpenMaicStage = 'draft' | 'published';
export type OpenMaicRole = 'student' | 'teacher';

export const TEACHER_DRAFT_CAPABILITIES = OPENMAIC_CAPABILITIES.filter(
  (capability) => capability !== 'model.invoke.learner',
);
export const STUDENT_PUBLISHED_CAPABILITIES = [
  'document.read',
  'asset.read',
  'runtime.read',
  'runtime.write',
  'agent.read',
  'model.invoke.learner',
] as const satisfies readonly OpenMaicCapability[];
export const TEACHER_PUBLISHED_CAPABILITIES = [
  'document.read',
  'asset.read',
] as const satisfies readonly OpenMaicCapability[];

export interface OpenMaicFamilyV1 {
  id: string;
  version: string;
  expiresAt: number;
}

export type OpenMaicAuthorizationRefV1 =
  | { kind: 'student-attempt'; selectionId: string; attemptId: string }
  | { kind: 'teacher-course' };

export interface OpenMaicLaunchGrantV1 {
  version: 1;
  state: string;
  sub: string;
  actorOrgId: string;
  contentOrgId: string;
  courseId: string;
  stageId: string;
  stage: OpenMaicStage;
  capabilities: OpenMaicCapability[];
  role: OpenMaicRole;
  roleOrigin: string;
  family: OpenMaicFamilyV1;
  iat: number;
  launchExp: number;
  coursePrincipal: string;
  personalPrincipal: string;
  learnerKey: string;
  authorizationRef: OpenMaicAuthorizationRefV1;
  /**
   * Where the "back to course" affordance sends the browser. Issued by the role
   * app, never accepted from the browser: an absolute URL that must live on
   * {@link OpenMaicLaunchGrantV1.roleOrigin}, so OpenMAIC can hand it straight
   * to `location.assign` without becoming an open redirect.
   */
  returnTo: string;
  nextPath: string;
}

export interface OpenMaicStageGrantV1 extends Omit<
  OpenMaicLaunchGrantV1,
  'version' | 'state' | 'family' | 'nextPath' | 'launchExp'
> {
  expiresAt: number;
}

export interface OpenMaicSessionV1 {
  version: 1;
  sub: string;
  family: OpenMaicFamilyV1;
  createdAt: number;
  expiresAt: number;
  grants: Record<string, OpenMaicStageGrantV1>;
}

export interface OpenMaicRenewIntentV1 {
  version: 1;
  state: string;
  sessionId: string;
  stageId: string;
  sub: string;
  family: OpenMaicFamilyV1;
  role: OpenMaicRole;
  authorizationRef: OpenMaicAuthorizationRefV1;
  createdAt: number;
  expiresAt: number;
}

/**
 * A one-time authorization to publish one draft stage.
 *
 * Publication is a content-service operation needing the teacher's own
 * credentials, which OpenMAIC deliberately never holds. OpenMAIC mints this
 * intent and hands the opaque state to the Teacher app, which does hold the
 * portal session, re-authorizes in real time, and performs the publish.
 *
 * Same wire shape and lifetime rules as {@link OpenMaicRenewIntentV1} — the key
 * prefix is what separates them. Teacher-only: the published copy is read-only
 * for every role.
 */
export interface OpenMaicPublishIntentV1 {
  version: 1;
  state: string;
  sessionId: string;
  stageId: string;
  sub: string;
  family: OpenMaicFamilyV1;
  role: 'teacher';
  authorizationRef: OpenMaicAuthorizationRefV1;
  createdAt: number;
  expiresAt: number;
}

const OPAQUE_ID = /^[A-Za-z0-9_-]{40,256}$/;
const CAPABILITY_SET = new Set<string>(OPENMAIC_CAPABILITIES);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function epochMillis(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isOpaqueOpenMaicId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID.test(value);
}

export function sameFamily(left: OpenMaicFamilyV1, right: OpenMaicFamilyV1): boolean {
  return (
    left.id === right.id && left.version === right.version && left.expiresAt === right.expiresAt
  );
}

export function parseOpenMaicFamily(value: unknown): OpenMaicFamilyV1 | null {
  const candidate = record(value);
  if (!candidate || !hasExactKeys(candidate, ['id', 'version', 'expiresAt'])) return null;
  if (!isOpaqueOpenMaicId(candidate.id) || !isOpaqueOpenMaicId(candidate.version)) return null;
  if (!epochMillis(candidate.expiresAt)) return null;
  return candidate as unknown as OpenMaicFamilyV1;
}

function parseAuthorizationRef(value: unknown): OpenMaicAuthorizationRefV1 | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.kind !== 'string') return null;
  if (candidate.kind === 'teacher-course' && hasExactKeys(candidate, ['kind'])) {
    return { kind: 'teacher-course' };
  }
  if (
    candidate.kind === 'student-attempt' &&
    hasExactKeys(candidate, ['kind', 'selectionId', 'attemptId']) &&
    nonEmpty(candidate.selectionId) &&
    nonEmpty(candidate.attemptId)
  ) {
    return {
      kind: 'student-attempt',
      selectionId: candidate.selectionId,
      attemptId: candidate.attemptId,
    };
  }
  return null;
}

function parseCapabilities(value: unknown): OpenMaicCapability[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((item) => typeof item === 'string' && CAPABILITY_SET.has(item))) return null;
  if (new Set(value).size !== value.length) return null;
  return value as OpenMaicCapability[];
}

function sameCapabilities(
  actual: readonly OpenMaicCapability[],
  expected: readonly OpenMaicCapability[],
): boolean {
  return (
    actual.length === expected.length && expected.every((capability) => actual.includes(capability))
  );
}

function capabilitiesMatchRole(
  role: OpenMaicRole,
  stage: OpenMaicStage,
  capabilities: readonly OpenMaicCapability[],
): boolean {
  if (role === 'student') {
    return stage === 'published' && sameCapabilities(capabilities, STUDENT_PUBLISHED_CAPABILITIES);
  }
  return stage === 'draft'
    ? sameCapabilities(capabilities, TEACHER_DRAFT_CAPABILITIES)
    : sameCapabilities(capabilities, TEACHER_PUBLISHED_CAPABILITIES);
}

/**
 * An absolute URL on `origin`, with no embedded credentials — safe to hand to
 * `location.assign`. A different host, a `javascript:` URL, or a relative path
 * is rejected rather than normalized, so a mis-issued grant fails closed
 * instead of navigating a teacher somewhere the role app never chose.
 */
function isUrlOnOrigin(value: unknown, origin: string): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  try {
    const url = new URL(value);
    return url.origin === origin && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function principalFieldsValid(value: {
  sub: string;
  actorOrgId: string;
  contentOrgId: string;
  courseId: string;
  coursePrincipal: string;
  personalPrincipal: string;
  learnerKey: string;
}): boolean {
  return (
    value.coursePrincipal === `reachacademy:org:${value.contentOrgId}:course:${value.courseId}` &&
    value.personalPrincipal === `reachacademy:subject:${value.sub}:org:${value.actorOrgId}` &&
    value.learnerKey === `reachacademy:subject:${value.sub}:course:${value.courseId}`
  );
}

export function isAllowedOpenMaicNextPath(nextPath: string, stageId: string): boolean {
  if (!nextPath.startsWith('/') || nextPath.startsWith('//') || nextPath.includes('\\'))
    return false;
  let url: URL;
  try {
    url = new URL(nextPath, 'https://openmaic.invalid');
  } catch {
    return false;
  }
  if (url.origin !== 'https://openmaic.invalid' || url.hash !== '') return false;
  if (url.pathname === `/classroom/${encodeURIComponent(stageId)}` && url.search === '')
    return true;
  if (url.pathname === '/' && url.searchParams.size === 2) {
    return url.searchParams.get('stageId') === stageId && url.searchParams.get('mode') === 'edit';
  }
  if (url.pathname === '/workspace') {
    const keys = [...url.searchParams.keys()];
    return (
      url.searchParams.size === 1 &&
      keys.every((key) => key === 'course') &&
      url.searchParams.get('course') === stageId
    );
  }
  return false;
}

const LAUNCH_KEYS = [
  'version',
  'state',
  'sub',
  'actorOrgId',
  'contentOrgId',
  'courseId',
  'stageId',
  'stage',
  'capabilities',
  'role',
  'roleOrigin',
  'family',
  'iat',
  'launchExp',
  'coursePrincipal',
  'personalPrincipal',
  'learnerKey',
  'authorizationRef',
  'returnTo',
  'nextPath',
] as const;

export function parseOpenMaicLaunchGrant(value: unknown): OpenMaicLaunchGrantV1 | null {
  const candidate = record(value);
  if (!candidate || !hasExactKeys(candidate, LAUNCH_KEYS) || candidate.version !== 1) return null;
  const family = parseOpenMaicFamily(candidate.family);
  const capabilities = parseCapabilities(candidate.capabilities);
  const authorizationRef = parseAuthorizationRef(candidate.authorizationRef);
  if (
    !isOpaqueOpenMaicId(candidate.state) ||
    !nonEmpty(candidate.sub) ||
    !nonEmpty(candidate.actorOrgId) ||
    !nonEmpty(candidate.contentOrgId) ||
    !nonEmpty(candidate.courseId) ||
    !nonEmpty(candidate.stageId) ||
    (candidate.stage !== 'draft' && candidate.stage !== 'published') ||
    (candidate.role !== 'student' && candidate.role !== 'teacher') ||
    !isOrigin(candidate.roleOrigin) ||
    !family ||
    !epochMillis(candidate.iat) ||
    !epochMillis(candidate.launchExp) ||
    !nonEmpty(candidate.coursePrincipal) ||
    !nonEmpty(candidate.personalPrincipal) ||
    !nonEmpty(candidate.learnerKey) ||
    !authorizationRef ||
    typeof candidate.nextPath !== 'string' ||
    !capabilities
  ) {
    return null;
  }
  const parsed = {
    ...candidate,
    family,
    capabilities,
    authorizationRef,
  } as unknown as OpenMaicLaunchGrantV1;
  if (parsed.launchExp < parsed.iat || parsed.launchExp - parsed.iat > 60_000) return null;
  if (parsed.launchExp > parsed.family.expiresAt) return null;
  if (!isUrlOnOrigin(parsed.returnTo, parsed.roleOrigin)) return null;
  if (!principalFieldsValid(parsed)) return null;
  if (!capabilitiesMatchRole(parsed.role, parsed.stage, parsed.capabilities)) return null;
  if (parsed.role === 'student' && parsed.authorizationRef.kind !== 'student-attempt') return null;
  if (parsed.role === 'teacher' && parsed.authorizationRef.kind !== 'teacher-course') return null;
  if (!isAllowedOpenMaicNextPath(parsed.nextPath, parsed.stageId)) return null;
  return parsed;
}

const STAGE_GRANT_KEYS: readonly string[] = [
  ...LAUNCH_KEYS.filter(
    (key) => !['version', 'state', 'family', 'nextPath', 'launchExp'].includes(key),
  ),
  'expiresAt',
];

export function stageGrantFromLaunch(launch: OpenMaicLaunchGrantV1): OpenMaicStageGrantV1 {
  return {
    sub: launch.sub,
    actorOrgId: launch.actorOrgId,
    contentOrgId: launch.contentOrgId,
    courseId: launch.courseId,
    stageId: launch.stageId,
    stage: launch.stage,
    capabilities: [...launch.capabilities],
    role: launch.role,
    roleOrigin: launch.roleOrigin,
    iat: launch.iat,
    coursePrincipal: launch.coursePrincipal,
    personalPrincipal: launch.personalPrincipal,
    learnerKey: launch.learnerKey,
    authorizationRef: launch.authorizationRef,
    returnTo: launch.returnTo,
    expiresAt: Math.min(launch.family.expiresAt, launch.iat + OPENMAIC_GRANT_TTL_MS),
  };
}

export function parseOpenMaicStageGrant(value: unknown): OpenMaicStageGrantV1 | null {
  const candidate = record(value);
  if (!candidate || !hasExactKeys(candidate, STAGE_GRANT_KEYS)) return null;
  const capabilities = parseCapabilities(candidate.capabilities);
  const authorizationRef = parseAuthorizationRef(candidate.authorizationRef);
  if (
    !nonEmpty(candidate.sub) ||
    !nonEmpty(candidate.actorOrgId) ||
    !nonEmpty(candidate.contentOrgId) ||
    !nonEmpty(candidate.courseId) ||
    !nonEmpty(candidate.stageId) ||
    (candidate.stage !== 'draft' && candidate.stage !== 'published') ||
    (candidate.role !== 'student' && candidate.role !== 'teacher') ||
    !isOrigin(candidate.roleOrigin) ||
    !epochMillis(candidate.iat) ||
    !epochMillis(candidate.expiresAt) ||
    !nonEmpty(candidate.coursePrincipal) ||
    !nonEmpty(candidate.personalPrincipal) ||
    !nonEmpty(candidate.learnerKey) ||
    !capabilities ||
    !authorizationRef
  ) {
    return null;
  }
  const parsed = {
    ...candidate,
    capabilities,
    authorizationRef,
  } as unknown as OpenMaicStageGrantV1;
  if (parsed.expiresAt > parsed.iat + OPENMAIC_GRANT_TTL_MS || parsed.expiresAt < parsed.iat)
    return null;
  if (!isUrlOnOrigin(parsed.returnTo, parsed.roleOrigin)) return null;
  if (!principalFieldsValid(parsed)) return null;
  if (!capabilitiesMatchRole(parsed.role, parsed.stage, parsed.capabilities)) return null;
  if (parsed.role === 'student' && parsed.authorizationRef.kind !== 'student-attempt') return null;
  if (parsed.role === 'teacher' && parsed.authorizationRef.kind !== 'teacher-course') return null;
  return parsed;
}

export function parseOpenMaicSession(value: unknown): OpenMaicSessionV1 | null {
  const candidate = record(value);
  if (
    !candidate ||
    !hasExactKeys(candidate, ['version', 'sub', 'family', 'createdAt', 'expiresAt', 'grants']) ||
    candidate.version !== 1 ||
    !nonEmpty(candidate.sub) ||
    !epochMillis(candidate.createdAt) ||
    !epochMillis(candidate.expiresAt)
  ) {
    return null;
  }
  const family = parseOpenMaicFamily(candidate.family);
  const grantsRecord = record(candidate.grants);
  if (
    !family ||
    !grantsRecord ||
    candidate.expiresAt !== family.expiresAt ||
    candidate.createdAt > candidate.expiresAt
  )
    return null;
  const grants: Record<string, OpenMaicStageGrantV1> = {};
  for (const [key, rawGrant] of Object.entries(grantsRecord)) {
    const grant = parseOpenMaicStageGrant(rawGrant);
    if (
      !grant ||
      key !== grant.stageId ||
      grant.sub !== candidate.sub ||
      grant.expiresAt > family.expiresAt
    ) {
      return null;
    }
    grants[key] = grant;
  }
  return {
    version: 1,
    sub: candidate.sub,
    family,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    grants,
  };
}

/** Shared by renew and publish intents — the key prefix is what separates them. */
const INTENT_KEYS = [
  'version',
  'state',
  'sessionId',
  'stageId',
  'sub',
  'family',
  'role',
  'authorizationRef',
  'createdAt',
  'expiresAt',
] as const;

export function parseOpenMaicPublishIntent(value: unknown): OpenMaicPublishIntentV1 | null {
  const candidate = record(value);
  if (
    !candidate ||
    !hasExactKeys(candidate, INTENT_KEYS) ||
    candidate.version !== 1 ||
    !isOpaqueOpenMaicId(candidate.state) ||
    !isOpaqueOpenMaicId(candidate.sessionId) ||
    !nonEmpty(candidate.stageId) ||
    !nonEmpty(candidate.sub) ||
    // The published copy is read-only for every role, so only a teacher can
    // ever have asked for a publication.
    candidate.role !== 'teacher' ||
    !epochMillis(candidate.createdAt) ||
    !epochMillis(candidate.expiresAt)
  ) {
    return null;
  }
  const family = parseOpenMaicFamily(candidate.family);
  const authorizationRef = parseAuthorizationRef(candidate.authorizationRef);
  if (
    !family ||
    !authorizationRef ||
    authorizationRef.kind !== 'teacher-course' ||
    candidate.expiresAt < candidate.createdAt ||
    candidate.expiresAt - candidate.createdAt > 60_000 ||
    candidate.expiresAt > family.expiresAt
  ) {
    return null;
  }
  return { ...candidate, family, authorizationRef } as unknown as OpenMaicPublishIntentV1;
}

export function parseOpenMaicRenewIntent(value: unknown): OpenMaicRenewIntentV1 | null {
  const candidate = record(value);
  if (
    !candidate ||
    !hasExactKeys(candidate, INTENT_KEYS) ||
    candidate.version !== 1 ||
    !isOpaqueOpenMaicId(candidate.state) ||
    !isOpaqueOpenMaicId(candidate.sessionId) ||
    !nonEmpty(candidate.stageId) ||
    !nonEmpty(candidate.sub) ||
    (candidate.role !== 'student' && candidate.role !== 'teacher') ||
    !epochMillis(candidate.createdAt) ||
    !epochMillis(candidate.expiresAt)
  ) {
    return null;
  }
  const family = parseOpenMaicFamily(candidate.family);
  const authorizationRef = parseAuthorizationRef(candidate.authorizationRef);
  if (
    !family ||
    !authorizationRef ||
    candidate.expiresAt < candidate.createdAt ||
    candidate.expiresAt - candidate.createdAt > 60_000 ||
    candidate.expiresAt > family.expiresAt
  ) {
    return null;
  }
  if (candidate.role === 'student' && authorizationRef.kind !== 'student-attempt') return null;
  if (candidate.role === 'teacher' && authorizationRef.kind !== 'teacher-course') return null;
  return { ...candidate, family, authorizationRef } as unknown as OpenMaicRenewIntentV1;
}
