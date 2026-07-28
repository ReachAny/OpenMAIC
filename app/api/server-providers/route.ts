import {
  getServerProviders,
  getServerTTSProviders,
  getServerASRProviders,
  getServerPDFProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerWebSearchProviders,
  getParallelSceneConcurrency,
  resolveApiKey,
  resolveBaseUrl,
  resolveTTSApiKey,
  resolveTTSCatalogBaseUrl,
  resolveASRApiKey,
  resolveASRBaseUrl,
  resolveImageApiKey,
  resolveImageBaseUrl,
  resolveVideoApiKey,
  resolveVideoBaseUrl,
} from '@/lib/server/provider-config';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { fetchModels } from '@/lib/server/model-fetch';

const log = createLogger('ServerProviders');

type ProviderInfo = { models?: string[]; disabled?: boolean };

async function enrichModelCatalog(
  providers: Record<string, ProviderInfo>,
  mode: string,
  resolveKey: (providerId: string) => string,
  resolveUrl: (providerId: string) => string | undefined,
): Promise<Record<string, ProviderInfo>> {
  const entries = await Promise.all(
    Object.entries(providers).map(async ([providerId, info]) => {
      if (info.disabled || info.models?.length) return [providerId, info] as const;

      const baseUrl = resolveUrl(providerId);
      if (!baseUrl) return [providerId, info] as const;

      try {
        const models = await fetchModels(baseUrl, resolveKey(providerId), { mode });
        const aliases = [...new Set(models.map((model) => model.id).filter(Boolean))];
        return [providerId, aliases.length > 0 ? { ...info, models: aliases } : info] as const;
      } catch (error) {
        log.warn(`Failed to discover ${mode} models for ${providerId}:`, error);
        return [providerId, info] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
}

export async function GET() {
  try {
    const [providers, tts, asr, image, video] = await Promise.all([
      enrichModelCatalog(getServerProviders(), 'chat', resolveApiKey, resolveBaseUrl),
      enrichModelCatalog(
        getServerTTSProviders(),
        'audio_speech',
        resolveTTSApiKey,
        resolveTTSCatalogBaseUrl,
      ),
      enrichModelCatalog(
        getServerASRProviders(),
        'audio_transcription',
        resolveASRApiKey,
        resolveASRBaseUrl,
      ),
      enrichModelCatalog(
        getServerImageProviders(),
        'image_generation',
        resolveImageApiKey,
        resolveImageBaseUrl,
      ),
      enrichModelCatalog(
        getServerVideoProviders(),
        'video_generation',
        resolveVideoApiKey,
        resolveVideoBaseUrl,
      ),
    ]);

    return apiSuccess({
      providers,
      tts,
      asr,
      pdf: getServerPDFProviders(),
      image,
      video,
      webSearch: getServerWebSearchProviders(),
      generation: {
        parallelSceneConcurrency: getParallelSceneConcurrency(),
      },
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
