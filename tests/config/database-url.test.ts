import { describe, expect, it } from 'vitest';

import {
  ensureOpenMaicDatabaseUrl,
  initializeOpenMaicDatabaseUrl,
} from '@/lib/config/database-url';

describe('OpenMAIC database URL resolution', () => {
  it('preserves an explicitly configured URL', () => {
    expect(
      ensureOpenMaicDatabaseUrl({
        DATABASE_URL: 'postgresql://configured',
        POSTGRES_HOST: 'ignored',
      }),
    ).toBe('postgresql://configured');
  });

  it('builds a URL from the shared POSTGRES tuple and encodes credentials', () => {
    expect(
      ensureOpenMaicDatabaseUrl({
        POSTGRES_HOST: 'pg.example.test',
        POSTGRES_PORT: '5432',
        POSTGRES_DB: 'reach any',
        POSTGRES_USER: 'reach@dev',
        POSTGRES_PASSWORD: 'p@ss/word',
      }),
    ).toBe('postgresql://reach%40dev:p%40ss%2Fword@pg.example.test:5432/reach%20any');
  });

  it('does not overwrite an existing URL during initialization', () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: 'postgresql://configured' };
    initializeOpenMaicDatabaseUrl(env);
    expect(env.DATABASE_URL).toBe('postgresql://configured');
  });
});
