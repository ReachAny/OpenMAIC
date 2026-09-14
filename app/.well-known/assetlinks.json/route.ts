import { twaDigitalAssetLinksResponse } from '@/lib/reachacademy/twa-assetlinks';

export const dynamic = 'force-dynamic';

export function GET() {
  return twaDigitalAssetLinksResponse(process.env.OPENMAIC_PUBLIC_HOSTNAME);
}
