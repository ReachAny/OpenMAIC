import { NextRequest, NextResponse } from 'next/server';

const ASSET_LINKS_PATH = '/.well-known/assetlinks.json';
const TEST_ASSET_LINKS_HOST = 'openmaic.test.reachany.cn';
const PRODUCTION_ASSET_LINKS_HOST = 'openmaic.reachany.cn';
const PUBLIC_ASSET_LINKS_HOSTS = new Set([TEST_ASSET_LINKS_HOST, PRODUCTION_ASSET_LINKS_HOST]);

function normalizeHostname(value: string | null | undefined): string | null {
  const firstValue = value?.split(',', 1)[0]?.trim();
  if (!firstValue) return null;

  try {
    const parsed = new URL(`https://${firstValue}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getPublicRequestHostname(request: NextRequest): string {
  const host = normalizeHostname(request.headers.get('host'));
  if (host && PUBLIC_ASSET_LINKS_HOSTS.has(host)) return host;

  // Proxies may append values; only allowlisted hosts reach this fallback,
  // while OPENMAIC_PUBLIC_HOSTNAME remains the deployment-authoritative gate.
  const forwardedHost = normalizeHostname(request.headers.get('x-forwarded-host'));
  if (forwardedHost && PUBLIC_ASSET_LINKS_HOSTS.has(forwardedHost)) return forwardedHost;

  return request.nextUrl.hostname.toLowerCase();
}

/** Convert string to Uint8Array */
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert ArrayBuffer to hex string */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify an HMAC-signed token using Web Crypto API (Edge-compatible) */
async function verifyToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const keyData = encode(accessCode);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));

  // Constant-length comparison (not truly constant-time in JS, but sufficient here)
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // This Digital Asset Links statement delegates the test-signed TWA only.
  // OpenMAIC's shared image also deploys to production, so require both the
  // deployment's configured public host and the proxy-aware request host.
  if (pathname === ASSET_LINKS_PATH) {
    const configuredHost = normalizeHostname(process.env.OPENMAIC_PUBLIC_HOSTNAME);
    const publicRequestHost = getPublicRequestHostname(request);
    return configuredHost === TEST_ASSET_LINKS_HOST && publicRequestHost === TEST_ASSET_LINKS_HOST
      ? NextResponse.next()
      : new NextResponse(null, { status: 404 });
  }

  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return NextResponse.next();
  }

  // Whitelist: access-code endpoints, health check
  if (pathname.startsWith('/api/access-code/') || pathname === '/api/health') {
    return NextResponse.next();
  }

  // Check cookie — validate HMAC signature, not just existence
  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && (await verifyToken(cookie.value, accessCode))) {
    return NextResponse.next();
  }

  // API requests without valid cookie → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  // Page requests → let through, frontend shows modal
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
