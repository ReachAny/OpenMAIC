import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { config, middleware } from '@/middleware';

const originalAccessCode = process.env.ACCESS_CODE;
const originalPublicHostname = process.env.OPENMAIC_PUBLIC_HOSTNAME;

afterEach(() => {
  if (originalAccessCode === undefined) {
    delete process.env.ACCESS_CODE;
  } else {
    process.env.ACCESS_CODE = originalAccessCode;
  }

  if (originalPublicHostname === undefined) {
    delete process.env.OPENMAIC_PUBLIC_HOSTNAME;
  } else {
    process.env.OPENMAIC_PUBLIC_HOSTNAME = originalPublicHostname;
  }
});

describe('middleware Digital Asset Links boundary', () => {
  it('serves the test-signed statement on the exact OpenMAIC test host', async () => {
    process.env.ACCESS_CODE = 'configured-for-test';
    process.env.OPENMAIC_PUBLIC_HOSTNAME = 'openmaic.test.reachany.cn';

    const response = await middleware(
      new NextRequest('https://openmaic.test.reachany.cn/.well-known/assetlinks.json'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('uses the forwarded public host when Next sees the internal container address', async () => {
    process.env.OPENMAIC_PUBLIC_HOSTNAME = 'openmaic.test.reachany.cn';

    const response = await middleware(
      new NextRequest('http://0.0.0.0:3000/.well-known/assetlinks.json', {
        headers: {
          host: 'openmaic:3000',
          'x-forwarded-host': 'openmaic.test.reachany.cn',
          'x-forwarded-proto': 'https',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('keeps the Digital Asset Links path inside the middleware matcher', () => {
    const [matcher] = config.matcher;

    expect(new RegExp(`^${matcher}$`).test('/.well-known/assetlinks.json')).toBe(true);
  });

  it.each(['openmaic.reachany.cn', 'unexpected.reachany.cn'])(
    'returns 404 for the test-signed statement on %s',
    async (hostname) => {
      process.env.OPENMAIC_PUBLIC_HOSTNAME = 'openmaic.test.reachany.cn';

      const response = await middleware(
        new NextRequest(`https://${hostname}/.well-known/assetlinks.json`),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('x-middleware-next')).toBeNull();
    },
  );

  it('rejects a forwarded test host in the production deployment', async () => {
    process.env.OPENMAIC_PUBLIC_HOSTNAME = 'openmaic.reachany.cn';

    const response = await middleware(
      new NextRequest('http://0.0.0.0:3000/.well-known/assetlinks.json', {
        headers: {
          host: 'openmaic:3000',
          'x-forwarded-host': 'openmaic.test.reachany.cn',
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it('preserves existing behavior for unrelated routes', async () => {
    delete process.env.ACCESS_CODE;

    const response = await middleware(
      new NextRequest('https://openmaic.reachany.cn/presentation/example'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
