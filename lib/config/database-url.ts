/**
 * OpenMAIC uses the same shared PostgreSQL instance as the Java services.
 *
 * Deployments may provide DATABASE_URL directly (the Kubernetes secret does),
 * while local ReachAcademy development intentionally exposes the canonical
 * POSTGRES_* tuple instead. Resolve that tuple once at process start so every
 * existing OpenMAIC persistence path keeps using its established DATABASE_URL
 * contract without introducing another deployment variable.
 */
export function ensureOpenMaicDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const configured = env.DATABASE_URL?.trim();
  if (configured) return configured;

  const host = env.POSTGRES_HOST?.trim();
  const database = env.POSTGRES_DB?.trim();
  const username = env.POSTGRES_USER?.trim();
  const password = env.POSTGRES_PASSWORD;
  if (!host || !database || !username || password === undefined) return undefined;

  const port = env.POSTGRES_PORT?.trim() || '5432';
  const url = new URL('postgresql://localhost');
  url.hostname = host;
  url.port = port;
  url.pathname = `/${encodeURIComponent(database)}`;
  url.username = username;
  url.password = password;
  return url.toString().replace(/^postgres:\/\//, 'postgresql://');
}

/** Mutate only the process environment used by OpenMAIC's existing stores. */
export function initializeOpenMaicDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.DATABASE_URL?.trim()) return;
  const resolved = ensureOpenMaicDatabaseUrl(env);
  if (resolved) env.DATABASE_URL = resolved;
}
