import { randomBytes } from 'node:crypto';

import {
  isOpaqueOpenMaicId,
  OPENMAIC_LAUNCH_TTL_SECONDS,
  parseOpenMaicLaunchGrant,
  type OpenMaicLaunchGrantV1,
} from './contracts';
import type { OpenMaicRedisStore } from './redis';

export const OPENMAIC_LAUNCH_KEY_PREFIX = 'reachany:openmaic-launch:';

export interface LaunchGrantManager {
  create(grant: OpenMaicLaunchGrantV1): Promise<string>;
  consume(
    code: string,
    state: string,
    validate?: (grant: OpenMaicLaunchGrantV1) => Promise<boolean>,
  ): Promise<OpenMaicLaunchGrantV1 | null>;
}

export function createLaunchGrantManager(
  store: OpenMaicRedisStore,
  options: { now?: () => number; randomId?: () => string } = {},
): LaunchGrantManager {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => randomBytes(32).toString('base64url'));
  return {
    async create(grant) {
      const parsed = parseOpenMaicLaunchGrant(grant);
      if (!parsed || parsed.launchExp <= now()) throw new Error('Invalid OpenMAIC launch grant');
      const ttl = Math.min(
        OPENMAIC_LAUNCH_TTL_SECONDS,
        Math.ceil((parsed.launchExp - now()) / 1_000),
        Math.ceil((parsed.family.expiresAt - now()) / 1_000),
      );
      if (ttl <= 0) throw new Error('Invalid OpenMAIC launch grant');
      const serialized = JSON.stringify(parsed);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomId();
        if (!isOpaqueOpenMaicId(code)) throw new Error('Invalid OpenMAIC launch code generator');
        if (await store.setIfAbsent(`${OPENMAIC_LAUNCH_KEY_PREFIX}${code}`, serialized, ttl)) {
          return code;
        }
      }
      throw new Error('Unable to allocate OpenMAIC launch code');
    },
    async consume(code, state, validate) {
      if (!isOpaqueOpenMaicId(code) || !isOpaqueOpenMaicId(state)) return null;
      const key = `${OPENMAIC_LAUNCH_KEY_PREFIX}${code}`;
      const serialized = await store.get(key);
      if (!serialized) return null;
      let decoded: unknown;
      try {
        decoded = JSON.parse(serialized) as unknown;
      } catch {
        return null;
      }
      const grant = parseOpenMaicLaunchGrant(decoded);
      if (
        !grant ||
        grant.state !== state ||
        grant.iat > now() ||
        grant.launchExp <= now() ||
        grant.family.expiresAt <= now() ||
        (validate && !(await validate(grant)))
      ) {
        return null;
      }
      return (await store.deleteIfValue(key, serialized)) ? grant : null;
    },
  };
}
