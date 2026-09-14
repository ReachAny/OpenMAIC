const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

const PRODUCTION_STATEMENT = {
  relation: [HANDLE_ALL_URLS],
  target: {
    namespace: 'android_app',
    package_name: 'com.reachany.academy.twa',
    sha256_cert_fingerprints: [
      '7C:4C:4B:71:2D:56:8C:69:CA:BE:D4:91:A1:12:E4:CF:35:38:75:41:93:9A:1C:85:49:CE:C5:23:66:7D:73:22',
    ],
  },
};

const TEST_STATEMENT = {
  relation: [HANDLE_ALL_URLS],
  target: {
    namespace: 'android_app',
    package_name: 'com.reachany.academy.twa.test',
    sha256_cert_fingerprints: [
      '8B:90:E0:F9:FE:20:5B:83:E6:E5:47:C6:A5:4D:F8:51:D8:E1:D4:4F:CA:25:0D:89:4B:76:04:D9:D3:1F:88:74',
    ],
  },
};

export function resolveTwaDigitalAssetLinks(hostname: string | undefined) {
  const normalizedHostname = hostname?.trim().toLowerCase();
  const statement =
    normalizedHostname === 'openmaic.reachacademy.cn'
      ? PRODUCTION_STATEMENT
      : normalizedHostname === 'openmaic.test.reachacademy.cn'
        ? TEST_STATEMENT
        : null;
  return statement == null ? null : [statement];
}

export function twaDigitalAssetLinksResponse(hostname: string | undefined): Response {
  const statements = resolveTwaDigitalAssetLinks(hostname);
  if (statements == null) {
    return Response.json(
      { error: 'TWA Digital Asset Links environment is not configured' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
  return Response.json(statements, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
