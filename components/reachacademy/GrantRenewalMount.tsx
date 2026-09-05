'use client';

import { useOpenMaicCapabilities } from '@/lib/reachacademy/bridge/client-capabilities';
import { useOpenMaicGrantRenewal } from '@/lib/reachacademy/use-openmaic-renewal';
import { useOpenMaicHostReturnUrl } from '@/lib/reachacademy/use-openmaic-host-return';

export function GrantRenewalMount() {
  const grant = useOpenMaicCapabilities();
  const returnTo = useOpenMaicHostReturnUrl(grant?.stageId);
  useOpenMaicGrantRenewal(grant?.stageId, grant?.roleOrigin, returnTo);
  return null;
}
