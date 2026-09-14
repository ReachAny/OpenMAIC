import { describe, expect, it } from 'vitest';

import {
  resolveTwaDigitalAssetLinks,
  twaDigitalAssetLinksResponse,
} from '@/lib/reachacademy/twa-assetlinks';

describe('ReachAcademy TWA Digital Asset Links', () => {
  it.each([
    ['openmaic.reachacademy.cn', 'com.reachany.academy.twa'],
    ['openmaic.test.reachacademy.cn', 'com.reachany.academy.twa.test'],
  ])('serves only the identity for %s', (hostname, packageName) => {
    const statements = resolveTwaDigitalAssetLinks(hostname);
    expect(statements).toHaveLength(1);
    expect(statements?.[0]?.target.package_name).toBe(packageName);
  });

  it('fails closed when the deployment hostname is missing or unreviewed', () => {
    expect(resolveTwaDigitalAssetLinks('openmaic.example.test')).toBeNull();
    expect(twaDigitalAssetLinksResponse(undefined).status).toBe(503);
  });
});
