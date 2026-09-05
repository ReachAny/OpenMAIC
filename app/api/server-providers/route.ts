import {
  getServerProviderCatalog,
  getServerPDFProviders,
  getServerWebSearchProviders,
  getParallelSceneConcurrency,
  isReachAnyManagedOnlyDeployment,
} from '@/lib/server/provider-config';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { requireOpenMaicRoute } from '@/lib/reachacademy/bridge/route-auth';

const log = createLogger('ServerProviders');

export async function GET(request: Request) {
  const auth = await requireOpenMaicRoute(request);
  if ('response' in auth) return auth.response;
  try {
    return apiSuccess({
      ...(await getServerProviderCatalog()),
      pdf: getServerPDFProviders(),
      webSearch: getServerWebSearchProviders(),
      generation: {
        parallelSceneConcurrency: getParallelSceneConcurrency(),
      },
      managedOnly: isReachAnyManagedOnlyDeployment(),
    });
  } catch (error) {
    log.error('Error fetching server providers:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
