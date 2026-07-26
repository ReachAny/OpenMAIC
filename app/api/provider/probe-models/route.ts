import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { fetchModels, ModelFetchError } from '@/lib/server/model-fetch';
import {
  isServerConfiguredProvider,
  resolveApiKey,
  resolveBaseUrl,
} from '@/lib/server/provider-config';

const log = createLogger('ProbeModels');

/** Model ids that are not chat models — filtered out of probe results. */
const NON_CHAT_PATTERN = /(tts|asr|whisper|embedding|rerank|mineru|image|video|voxcpm|moderation)/i;

/**
 * POST /api/provider/probe-models
 *
 * Discovers the chat models a provider exposes, via the OpenAI-compatible
 * /models endpoint (with multi-candidate fallback). Returns the lit-up list, or
 * a typed status so the UI can fall back to manual model entry.
 *
 * For a server-configured provider the operator's base URL and key are used and
 * any client-sent pair is ignored, matching the verify-*-provider routes. Those
 * credentials are deliberately never sent to the browser, so without this the
 * button could only ever probe with an empty key.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { providerId, baseUrl, apiKey, modelsUrl } = body as {
      providerId?: string;
      baseUrl?: string;
      apiKey?: string;
      modelsUrl?: string;
    };

    const managed = !!providerId && isServerConfiguredProvider('providers', providerId);
    const effectiveBaseUrl = managed ? resolveBaseUrl(providerId) : baseUrl;
    const effectiveApiKey = managed ? resolveApiKey(providerId, '') : apiKey;
    // A managed provider without a base URL has nothing to probe: the operator
    // configured only a key, so the SDK would fall back to the vendor default
    // rather than to anything this route could discover.
    if (!effectiveBaseUrl) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        managed ? 'This provider has no server-configured base URL' : 'baseUrl is required',
      );
    }

    // SSRF guard applies to client-supplied URLs only. A server-configured base
    // URL is the operator's own gateway — typically an in-cluster address that
    // the guard would reject — and is trusted for the same reason the other
    // managed-provider routes trust it.
    const clientUrls = managed ? [] : ([baseUrl, modelsUrl].filter(Boolean) as string[]);
    for (const url of clientUrls) {
      const ssrfError = await validateUrlForSSRF(url);
      if (ssrfError) return apiError('INVALID_REQUEST', 400, ssrfError);
    }

    const models = await fetchModels(effectiveBaseUrl, effectiveApiKey || '', {
      ...(managed ? {} : { modelsUrlOverride: modelsUrl }),
    });
    const chatModels = models.filter((m) => !NON_CHAT_PATTERN.test(m.id));

    return apiSuccess({
      models: chatModels.map((m) => ({ id: m.id, ownedBy: m.ownedBy })),
      total: models.length,
      filtered: models.length - chatModels.length,
    });
  } catch (error) {
    if (error instanceof ModelFetchError) {
      if (error.status >= 300 && error.status < 400) {
        return apiError('REDIRECT_NOT_ALLOWED', 403, 'Redirects are not allowed');
      }
      if (error.status === 401 || error.status === 403) {
        return apiError('INVALID_REQUEST', 401, 'API key is invalid or expired');
      }
      if (error.status === 404) {
        // No /models endpoint — signal the UI (via 404) to use manual model entry.
        return apiError('INVALID_REQUEST', 404, 'This provider does not expose a model list');
      }
      return apiError('INTERNAL_ERROR', 502, error.message);
    }
    log.error('Model probe failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to probe models',
    );
  }
}
