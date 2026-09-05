import { getDomain } from 'tldts';

const ALLOWED_OPENMAIC_HOSTS = new Set([
  '127.0.0.1',
  'openmaic.test.reachacademy.cn',
  'openmaic.reachacademy.cn',
]);

/**
 * Resolve the public origin represented by an incoming request. Next may
 * construct request.url from its localhost development base even when the
 * actual Host header is a loopback address; forwarded headers preserve the
 * origin that the browser used to reach this instance.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.trim();
  const host = forwardedHost || request.headers.get('host')?.trim();
  if (!host) return url.origin;
  const forwardedProto = request.headers.get('x-forwarded-proto')?.trim();
  const protocol = forwardedProto || url.protocol.replace(/:$/, '');
  try {
    const resolved = new URL(`${protocol}://${host}`);
    return ALLOWED_OPENMAIC_HOSTS.has(resolved.hostname) ? resolved.origin : url.origin;
  } catch {
    return url.origin;
  }
}

export function isSameOpenMaicRenewalSite(roleOrigin: string, openMaicOrigin: string): boolean {
  let role: URL;
  let openMaic: URL;
  try {
    role = new URL(roleOrigin);
    openMaic = new URL(openMaicOrigin);
  } catch {
    return false;
  }
  if (
    role.origin !== roleOrigin ||
    openMaic.origin !== openMaicOrigin ||
    role.protocol !== openMaic.protocol ||
    !['http:', 'https:'].includes(role.protocol)
  ) {
    return false;
  }
  const loopback = role.hostname === '127.0.0.1' || openMaic.hostname === '127.0.0.1';
  if (loopback) return role.hostname === '127.0.0.1' && openMaic.hostname === '127.0.0.1';
  if (role.hostname === 'localhost' || openMaic.hostname === 'localhost') return false;
  const roleDomain = getDomain(role.hostname, { allowPrivateDomains: true });
  const openMaicDomain = getDomain(openMaic.hostname, { allowPrivateDomains: true });
  return roleDomain !== null && roleDomain === openMaicDomain;
}

export function hasValidMutationOrigin(request: Request): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return true;
  const origin = request.headers.get('origin');
  if (!origin || origin !== requestOrigin(request)) return false;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
