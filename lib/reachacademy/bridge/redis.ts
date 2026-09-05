import Redis from 'ioredis';

export interface OpenMaicRedisEnvironment {
  [key: string]: string | undefined;
  REACHANY_FRONTEND_EXCHANGE_REDIS_DB?: string;
  REACHANY_FRONTEND_EXCHANGE_REDIS_URL?: string;
  REACHANY_FRONTEND_REDIS_DB?: string;
  REACHANY_FRONTEND_REDIS_HOST?: string;
  REACHANY_FRONTEND_REDIS_PASSWORD?: string;
  REACHANY_FRONTEND_REDIS_PORT?: string;
  REACHANY_FRONTEND_REDIS_URL?: string;
  REACHANY_FRONTEND_REDIS_USERNAME?: string;
  REDIS_HOST?: string;
  REDIS_PASSWORD?: string;
  REDIS_PORT?: string;
  REDIS_USERNAME?: string;
}

export type OpenMaicRedisConfiguration =
  | { kind: 'url'; url: string; db: number }
  | {
      kind: 'plain';
      db: number;
      host: string;
      password?: string;
      port: number;
      username?: string;
    };

export interface OpenMaicRedisStore {
  compareAndSet(
    key: string,
    expectedValue: string,
    replacementValue: string,
    ttlSeconds: number,
  ): Promise<boolean>;
  deleteIfValue(key: string, expectedValue: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<string | null>;
  ping(): Promise<void>;
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

interface RedisCommands {
  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    ...args: Array<number | string>
  ): Promise<unknown>;
  exists(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  ping(): Promise<string>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    ttlSeconds: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
}

const COMPARE_AND_DELETE =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const COMPARE_AND_SET =
  "if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end";

function redisDatabase(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Invalid frontend Redis database');
  }
  return parsed;
}

function redisPort(value: string | undefined): number {
  const parsed = Number(value ?? 6379);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error('Invalid frontend Redis port');
  }
  return parsed;
}

function databaseFromUrl(value: string): number {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid frontend Redis URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('Invalid frontend Redis URL protocol');
  }
  const path = parsed.pathname.replace(/^\//, '');
  if (path === '') return 0;
  if (!/^\d+$/.test(path)) throw new Error('Invalid frontend Redis URL database');
  return redisDatabase(path);
}

export function resolveOpenMaicRedisConfiguration(
  env: OpenMaicRedisEnvironment = process.env,
): OpenMaicRedisConfiguration {
  const connection =
    env.REACHANY_FRONTEND_REDIS_URL?.trim() || env.REACHANY_FRONTEND_EXCHANGE_REDIS_URL?.trim();
  const explicitDatabase =
    env.REACHANY_FRONTEND_REDIS_DB ?? env.REACHANY_FRONTEND_EXCHANGE_REDIS_DB;
  if (connection) {
    const db = databaseFromUrl(connection);
    if (explicitDatabase !== undefined && redisDatabase(explicitDatabase) !== db) {
      throw new Error('Frontend Redis URL database conflicts with explicit database');
    }
    return { kind: 'url', url: connection, db };
  }
  return {
    kind: 'plain',
    db: redisDatabase(explicitDatabase),
    host: env.REACHANY_FRONTEND_REDIS_HOST ?? env.REDIS_HOST ?? '127.0.0.1',
    password: env.REACHANY_FRONTEND_REDIS_PASSWORD || env.REDIS_PASSWORD || undefined,
    port: redisPort(env.REACHANY_FRONTEND_REDIS_PORT ?? env.REDIS_PORT),
    username: env.REACHANY_FRONTEND_REDIS_USERNAME || env.REDIS_USERNAME || undefined,
  };
}

export function createOpenMaicRedisStore(redis: RedisCommands): OpenMaicRedisStore {
  return {
    async compareAndSet(key, expectedValue, replacementValue, ttlSeconds) {
      const result = await redis.eval(
        COMPARE_AND_SET,
        1,
        key,
        expectedValue,
        replacementValue,
        ttlSeconds,
      );
      return result === 1;
    },
    async deleteIfValue(key, expectedValue) {
      return (await redis.eval(COMPARE_AND_DELETE, 1, key, expectedValue)) === 1;
    },
    async exists(key) {
      return (await redis.exists(key)) === 1;
    },
    get: (key) => redis.get(key),
    async ping() {
      if ((await redis.ping()) !== 'PONG') throw new Error('Frontend Redis ping failed');
    },
    async setIfAbsent(key, value, ttlSeconds) {
      return (await redis.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
    },
  };
}

const REDIS_KEY = Symbol.for('openmaic.reachacademy.redis');
const globalRedis = globalThis as typeof globalThis & { [REDIS_KEY]?: OpenMaicRedisStore };

export function getOpenMaicRedisStore(
  env: OpenMaicRedisEnvironment = process.env,
): OpenMaicRedisStore {
  if (globalRedis[REDIS_KEY]) return globalRedis[REDIS_KEY];
  const configuration = resolveOpenMaicRedisConfiguration(env);
  const options = { enableReadyCheck: true, lazyConnect: true, maxRetriesPerRequest: 1 } as const;
  const client =
    configuration.kind === 'url'
      ? new Redis(configuration.url, options)
      : new Redis({
          ...options,
          db: configuration.db,
          host: configuration.host,
          password: configuration.password,
          port: configuration.port,
          username: configuration.username,
        });
  return (globalRedis[REDIS_KEY] = createOpenMaicRedisStore(client));
}

export function createMemoryOpenMaicRedisStore(now: () => number = Date.now): OpenMaicRedisStore {
  const values = new Map<string, { value: string; expiresAt: number }>();
  const read = (key: string) => {
    const value = values.get(key);
    if (!value || value.expiresAt <= now()) {
      values.delete(key);
      return null;
    }
    return value;
  };
  return {
    async compareAndSet(key, expectedValue, replacementValue, ttlSeconds) {
      if (read(key)?.value !== expectedValue) return false;
      values.set(key, { value: replacementValue, expiresAt: now() + ttlSeconds * 1_000 });
      return true;
    },
    async deleteIfValue(key, expectedValue) {
      if (read(key)?.value !== expectedValue) return false;
      values.delete(key);
      return true;
    },
    async exists(key) {
      return read(key) !== null;
    },
    async get(key) {
      return read(key)?.value ?? null;
    },
    async ping() {},
    async setIfAbsent(key, value, ttlSeconds) {
      if (read(key)) return false;
      values.set(key, { value, expiresAt: now() + ttlSeconds * 1_000 });
      return true;
    },
  };
}
