import { NextRequest, NextResponse } from 'next/server';

import { OPENMAIC_SESSION_COOKIE } from '@/lib/reachacademy/bridge/contracts';
import { classifyOpenMaicApiRoute } from '@/lib/reachacademy/bridge/route-classification';

function denied(status: number): NextResponse {
  return NextResponse.json(
    { error: { code: 'OPENMAIC_REQUEST_DENIED', message: 'request denied' } },
    { status },
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/')) {
    const classification = classifyOpenMaicApiRoute(pathname, request.method);
    if (!classification || classification.auth === 'retired') return denied(404);
    if (
      classification.auth === 'public' ||
      classification.auth === 'launch-code' ||
      classification.auth === 'renew-callback'
    ) {
      return NextResponse.next();
    }
    return request.cookies.has(OPENMAIC_SESSION_COOKIE) ? NextResponse.next() : denied(401);
  }

  const protectedPage =
    pathname === '/' ||
    pathname === '/workspace' ||
    pathname.startsWith('/workspace/') ||
    pathname.startsWith('/workbench/') ||
    pathname.startsWith('/classroom/') ||
    pathname.startsWith('/generation-preview');
  if (protectedPage && !request.cookies.has(OPENMAIC_SESSION_COOKIE)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
