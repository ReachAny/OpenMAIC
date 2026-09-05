import type { OpenMaicFamilyV1 } from './contracts';
import type { OpenMaicRedisStore } from './redis';

const FAMILY_PREFIX = 'reachany:frontend-session:family:';
const CUTOFF_PREFIX = 'revoked:subject:';
const ISSUANCE_KEYS = [
  'revoked:subject-issuance-block:',
  'revoked:subject-issuance-active:',
] as const;

export function parseIsoInstant(value: string): bigint | null {
  if (/^\d+$/.test(value)) return BigInt(value) * BigInt(1_000);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match[1].split(/[-T:]/).map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const wholeSecond = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(wholeSecond)) return null;
  return BigInt(wholeSecond) * BigInt(1_000_000) + BigInt((match[2] ?? '').padEnd(9, '0') || '0');
}

function parseFamilyMarker(value: string): { v: 1; version: string; expiresAt: number } | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const marker = decoded as Record<string, unknown>;
  if (
    marker.v !== 1 ||
    typeof marker.version !== 'string' ||
    marker.version.length === 0 ||
    !Number.isSafeInteger(marker.expiresAt)
  ) {
    return null;
  }
  return marker as { v: 1; version: string; expiresAt: number };
}

export interface OpenMaicIdentityCheck {
  sub: string;
  family: OpenMaicFamilyV1;
  launchIat: number;
  sessionCreatedAt?: number;
  now?: number;
}

export async function isOpenMaicIdentityCurrent(
  store: OpenMaicRedisStore,
  check: OpenMaicIdentityCheck,
): Promise<boolean> {
  try {
    const now = check.now ?? Date.now();
    if (check.family.expiresAt <= now) {
      return false;
    }
    const serializedFamily = await store.get(`${FAMILY_PREFIX}${check.family.id}`);
    if (!serializedFamily) {
      return false;
    }
    const marker = parseFamilyMarker(serializedFamily);
    if (
      !marker ||
      marker.version !== check.family.version ||
      marker.expiresAt !== check.family.expiresAt ||
      marker.expiresAt <= now
    ) {
      return false;
    }

    const taggedCutoff = await store.get(`${CUTOFF_PREFIX}{${check.sub}}`);
    const serializedCutoff = taggedCutoff ?? (await store.get(`${CUTOFF_PREFIX}${check.sub}`));
    if (serializedCutoff !== null) {
      const cutoff = parseIsoInstant(serializedCutoff);
      if (cutoff === null) {
        return false;
      }
      if (BigInt(check.launchIat) * BigInt(1_000_000) <= cutoff) {
        return false;
      }
      if (
        check.sessionCreatedAt !== undefined &&
        BigInt(check.sessionCreatedAt) * BigInt(1_000_000) <= cutoff
      ) {
        return false;
      }
    }

    for (const prefix of ISSUANCE_KEYS) {
      if (await store.exists(`${prefix}{${check.sub}}`)) {
        return false;
      }
      if (await store.exists(`${prefix}${check.sub}`)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
