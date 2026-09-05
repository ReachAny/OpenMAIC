import { randomBytes } from 'node:crypto';

import {
  isOpaqueOpenMaicId,
  OPENMAIC_RENEW_TTL_SECONDS,
  OPENMAIC_SESSION_COOKIE,
  parseOpenMaicRenewIntent,
  parseOpenMaicSession,
  sameFamily,
  stageGrantFromLaunch,
  type OpenMaicLaunchGrantV1,
  type OpenMaicPublishIntentV1,
  type OpenMaicRenewIntentV1,
  type OpenMaicSessionV1,
} from './contracts';
import type { OpenMaicRedisStore } from './redis';

export const OPENMAIC_SESSION_KEY_PREFIX = 'reachany:openmaic-session:';
export const OPENMAIC_RENEW_KEY_PREFIX = 'reachany:openmaic-renew:';
export const OPENMAIC_PUBLISH_KEY_PREFIX = 'reachany:openmaic-publish:';

function ttlSeconds(expiresAt: number, now: number): number {
  return Math.ceil((expiresAt - now) / 1_000);
}

export interface OpenMaicSessionManager {
  consumeRenewIntent(state: string): Promise<OpenMaicRenewIntentV1 | null>;
  createOrMerge(
    existingSessionId: string | undefined,
    launch: OpenMaicLaunchGrantV1,
  ): Promise<{ id: string; session: OpenMaicSessionV1 }>;
  createPublishIntent(sessionId: string, stageId: string): Promise<OpenMaicPublishIntentV1>;
  createRenewIntent(sessionId: string, stageId: string): Promise<OpenMaicRenewIntentV1>;
  read(sessionId: string): Promise<{ serialized: string; session: OpenMaicSessionV1 } | null>;
  replaceGrant(
    sessionId: string,
    expected: OpenMaicSessionV1,
    launch: OpenMaicLaunchGrantV1,
  ): Promise<OpenMaicSessionV1 | null>;
}

export function createOpenMaicSessionManager(
  store: OpenMaicRedisStore,
  options: { now?: () => number; randomId?: () => string } = {},
): OpenMaicSessionManager {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => randomBytes(32).toString('base64url'));

  async function read(sessionId: string) {
    if (!isOpaqueOpenMaicId(sessionId)) return null;
    const serialized = await store.get(`${OPENMAIC_SESSION_KEY_PREFIX}${sessionId}`);
    if (!serialized) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(serialized) as unknown;
    } catch {
      return null;
    }
    const session = parseOpenMaicSession(decoded);
    if (!session || session.expiresAt <= now()) return null;
    return { serialized, session };
  }

  async function createFresh(launch: OpenMaicLaunchGrantV1) {
    const createdAt = now();
    const session: OpenMaicSessionV1 = {
      version: 1,
      sub: launch.sub,
      family: launch.family,
      createdAt,
      expiresAt: launch.family.expiresAt,
      grants: { [launch.stageId]: stageGrantFromLaunch(launch) },
    };
    const ttl = ttlSeconds(session.expiresAt, createdAt);
    if (ttl <= 0) throw new Error('OpenMAIC session family has expired');
    const serialized = JSON.stringify(session);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = randomId();
      if (!isOpaqueOpenMaicId(id)) throw new Error('Invalid OpenMAIC session id generator');
      if (await store.setIfAbsent(`${OPENMAIC_SESSION_KEY_PREFIX}${id}`, serialized, ttl)) {
        return { id, session };
      }
    }
    throw new Error('Unable to allocate OpenMAIC session');
  }

  /**
   * Mint a one-time intent against a live stage grant.
   *
   * Renew and publish intents have the same wire shape and the same lifetime
   * rules (NX write, 60-second ceiling, consumed by compare-and-delete); only
   * the key prefix and the extra grant precondition differ.
   */
  async function createIntent(
    keyPrefix: string,
    sessionId: string,
    stageId: string,
    require?: (grant: OpenMaicSessionV1['grants'][string]) => void,
  ): Promise<OpenMaicRenewIntentV1> {
    const current = await read(sessionId);
    const grant = current?.session.grants[stageId];
    if (!current || !grant || grant.expiresAt <= now()) {
      throw new Error('OpenMAIC stage grant is unavailable');
    }
    require?.(grant);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const state = randomId();
      if (!isOpaqueOpenMaicId(state)) throw new Error('Invalid OpenMAIC intent state generator');
      const createdAt = now();
      const expiresAt = Math.min(
        current.session.expiresAt,
        createdAt + OPENMAIC_RENEW_TTL_SECONDS * 1_000,
      );
      const intent: OpenMaicRenewIntentV1 = {
        version: 1,
        state,
        sessionId,
        stageId,
        sub: current.session.sub,
        family: current.session.family,
        role: grant.role,
        authorizationRef: grant.authorizationRef,
        createdAt,
        expiresAt,
      };
      if (
        await store.setIfAbsent(
          `${keyPrefix}${state}`,
          JSON.stringify(intent),
          Math.min(OPENMAIC_RENEW_TTL_SECONDS, ttlSeconds(expiresAt, createdAt)),
        )
      ) {
        return intent;
      }
    }
    throw new Error('Unable to allocate OpenMAIC intent');
  }

  return {
    async consumeRenewIntent(state) {
      if (!isOpaqueOpenMaicId(state)) return null;
      const key = `${OPENMAIC_RENEW_KEY_PREFIX}${state}`;
      const serialized = await store.get(key);
      if (!serialized) return null;
      let decoded: unknown;
      try {
        decoded = JSON.parse(serialized) as unknown;
      } catch {
        return null;
      }
      const intent = parseOpenMaicRenewIntent(decoded);
      if (!intent || intent.state !== state || intent.expiresAt <= now()) return null;
      return (await store.deleteIfValue(key, serialized)) ? intent : null;
    },
    async createOrMerge(existingSessionId, launch) {
      if (existingSessionId) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const current = await read(existingSessionId);
          if (!current) break;
          if (
            current.session.sub !== launch.sub ||
            !sameFamily(current.session.family, launch.family)
          ) {
            break;
          }
          const replacement: OpenMaicSessionV1 = {
            ...current.session,
            grants: {
              ...current.session.grants,
              [launch.stageId]: stageGrantFromLaunch(launch),
            },
          };
          const ttl = ttlSeconds(current.session.expiresAt, now());
          if (ttl <= 0) break;
          if (
            await store.compareAndSet(
              `${OPENMAIC_SESSION_KEY_PREFIX}${existingSessionId}`,
              current.serialized,
              JSON.stringify(replacement),
              ttl,
            )
          ) {
            return { id: existingSessionId, session: replacement };
          }
        }
      }
      return createFresh(launch);
    },
    async createPublishIntent(sessionId, stageId) {
      const intent = await createIntent(
        OPENMAIC_PUBLISH_KEY_PREFIX,
        sessionId,
        stageId,
        (grant) => {
          // Publication writes the immutable published copy. A student grant —
          // or a teacher's read-only preview of an already-published stage —
          // must never be able to mint the intent that authorizes it.
          if (grant.role !== 'teacher' || grant.stage !== 'draft') {
            throw new Error('OpenMAIC publication requires a teacher draft grant');
          }
        },
      );
      return intent as OpenMaicPublishIntentV1;
    },
    async createRenewIntent(sessionId, stageId) {
      return createIntent(OPENMAIC_RENEW_KEY_PREFIX, sessionId, stageId);
    },
    read,
    async replaceGrant(sessionId, expected, launch) {
      if (
        expected.sub !== launch.sub ||
        !sameFamily(expected.family, launch.family) ||
        expected.expiresAt <= now()
      ) {
        return null;
      }
      const current = await read(sessionId);
      if (!current || JSON.stringify(current.session) !== JSON.stringify(expected)) return null;
      const replacement: OpenMaicSessionV1 = {
        ...expected,
        grants: { ...expected.grants, [launch.stageId]: stageGrantFromLaunch(launch) },
      };
      const ttl = ttlSeconds(expected.expiresAt, now());
      if (ttl <= 0) return null;
      return (await store.compareAndSet(
        `${OPENMAIC_SESSION_KEY_PREFIX}${sessionId}`,
        current.serialized,
        JSON.stringify(replacement),
        ttl,
      ))
        ? replacement
        : null;
    },
  };
}

export function openMaicSessionCookie(
  sessionId: string,
  expiresAt: number,
  requestUrl: string,
  now: number = Date.now(),
): string {
  if (!isOpaqueOpenMaicId(sessionId)) throw new Error('Invalid OpenMAIC session id');
  const url = new URL(requestUrl);
  const maxAge = Math.max(0, Math.floor((expiresAt - now) / 1_000));
  return [
    `${OPENMAIC_SESSION_COOKIE}=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(url.protocol === 'https:' ? ['Secure'] : []),
  ].join('; ');
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    return value || undefined;
  }
  return undefined;
}
