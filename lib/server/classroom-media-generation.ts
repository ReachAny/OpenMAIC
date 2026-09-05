/**
 * Server-side media and TTS generation for classrooms.
 *
 * Generates image/video files and TTS audio for a classroom,
 * writes them to disk, and returns serving URL mappings.
 */

import path from 'path';
import { createLogger } from '@/lib/logger';
import { putServerAssetBytes } from '@/lib/server/server-asset-bytes';
import { generateImage } from '@/lib/media/image-providers';
import { generateVideo, normalizeVideoOptions } from '@/lib/media/video-providers';
import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_VOICES, DEFAULT_TTS_MODELS, TTS_PROVIDERS } from '@/lib/audio/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import {
  assertReachAnyManagedModelAllowed,
  assertReachAnyProviderAllowed,
  getReachAnyManagedModels,
  getServerImageProviders,
  getServerVideoProviders,
  getServerTTSProviders,
  isReachAnyManagedOnlyDeployment,
  resolveImageApiKey,
  resolveImageBaseUrl,
  resolveImageModel,
  resolveVideoApiKey,
  resolveVideoBaseUrl,
  resolveVideoModel,
  resolveTTSApiKey,
  resolveTTSBaseUrl,
} from '@/lib/server/provider-config';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type { ImageProviderId } from '@/lib/media/types';
import type { VideoProviderId } from '@/lib/media/types';
import type { TTSProviderId } from '@/lib/audio/types';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';
import { isGeneratedMediaPlaceholder } from '@/lib/media/media-ref';
import { VOXCPM_AUTO_VOICE_ID, VOXCPM_TTS_PROVIDER_ID } from '@/lib/audio/voxcpm';

const log = createLogger('ClassroomMedia');

/**
 * The classroom JSON payload is a pre-conversion transport, not a persisted
 * DSL document. `audioUrl` is gone from the `SpeechAction` contract, but the
 * file-based classroom store has no asset registry to allocate from, so the
 * server still hands the client the serving URL beside the derived `audioId`.
 * The app-side reference converter ingests the URL's bytes and rewrites the
 * pair to one allocated asset id when the classroom is first fetched, before
 * the document is persisted client-side; the URL never enters a stored
 * document.
 */
type ServerTransportSpeechAction = SpeechAction & { audioUrl?: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes
const DOWNLOAD_MAX_SIZE = 100 * 1024 * 1024; // 100 MB

async function downloadToBuffer(url: string): Promise<Buffer> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  const contentLength = Number(resp.headers.get('content-length') || 0);
  if (contentLength > DOWNLOAD_MAX_SIZE) {
    throw new Error(`File too large: ${contentLength} bytes (max ${DOWNLOAD_MAX_SIZE})`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Image / Video generation
// ---------------------------------------------------------------------------

export async function generateMediaForClassroom(
  outlines: SceneOutline[],
  classroomId: string,
  baseUrl: string,
  coursePrincipal?: string,
): Promise<Record<string, string>> {
  void baseUrl;

  // Collect all media generation requests from outlines
  const requests = outlines.flatMap((o) => o.mediaGenerations ?? []);
  if (requests.length === 0) return {};

  // Resolve providers, excluding operator force-disabled ones (server
  // precedence, #665 — mirror the TTS listing's disabled flag).
  const imageProviderIds = Object.entries(getServerImageProviders())
    .filter(([, info]) => !info.disabled)
    .map(([id]) => id);
  const videoProviderIds = Object.entries(getServerVideoProviders())
    .filter(([, info]) => !info.disabled)
    .map(([id]) => id);

  const mediaMap: Record<string, string> = {};

  // In a ReachAny managed deployment the model-service catalog is the only
  // source of executable model IDs. Do not fall back to OpenMAIC's static
  // adapter defaults when the catalog is unavailable or empty.
  const managedImageModels = isReachAnyManagedOnlyDeployment()
    ? await getReachAnyManagedModels('image_generation')
    : undefined;
  const managedVideoModels =
    isReachAnyManagedOnlyDeployment() && videoProviderIds.length > 0
      ? await getReachAnyManagedModels('video_generation')
      : undefined;

  // Separate image and video requests, generate each type sequentially
  // but run the two types in parallel (providers often have limited concurrency).
  const imageRequests = requests.filter((r) => r.type === 'image' && imageProviderIds.length > 0);
  const videoRequests = requests.filter((r) => r.type === 'video' && videoProviderIds.length > 0);

  const generateImages = async () => {
    for (const req of imageRequests) {
      try {
        const providerId = imageProviderIds[0] as ImageProviderId;
        assertReachAnyProviderAllowed('image', providerId);
        const apiKey = resolveImageApiKey(providerId);
        const providerConfig = IMAGE_PROVIDERS[providerId];
        if (providerConfig?.requiresApiKey && !apiKey) {
          log.warn(`No API key for image provider "${providerId}", skipping ${req.elementId}`);
          continue;
        }
        // No client model here — the server-side `IMAGE_<PREFIX>_MODELS` pin
        // (first entry) is authoritative when set; otherwise fall back to the
        // first catalog model so key-only deployments keep generating. This
        // path is internal (no HTTP response to fail loud with), so the
        // adapter's requireModel must stay a backstop, never the primary
        // failure mode.
        const model = managedImageModels
          ? managedImageModels[0]
          : (resolveImageModel(providerId) ?? providerConfig?.models?.[0]?.id);
        if (managedImageModels && !model) {
          log.warn(`No ReachAny image model is available, skipping ${req.elementId}`);
          continue;
        }
        await assertReachAnyManagedModelAllowed('image_generation', 'image', providerId, model);

        const result = await generateImage(
          { providerId, apiKey, baseUrl: resolveImageBaseUrl(providerId), model },
          { prompt: req.prompt, aspectRatio: req.aspectRatio || '16:9' },
        );

        let buf: Buffer;
        let ext: string;
        if (result.base64) {
          buf = Buffer.from(result.base64, 'base64');
          ext = 'png';
        } else if (result.url) {
          buf = await downloadToBuffer(result.url);
          const urlExt = path.extname(new URL(result.url).pathname).replace('.', '');
          ext = ['png', 'jpg', 'jpeg', 'webp'].includes(urlExt) ? urlExt : 'png';
        } else {
          log.warn(`Image generation returned no data for ${req.elementId}`);
          continue;
        }

        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        mediaMap[req.elementId] = await putServerAssetBytes({
          principal: coursePrincipal ?? '',
          bytes: buf,
          mime,
          meta: { stageId: classroomId, source: 'classroom-image', prompt: req.prompt },
        });
        log.info(`Generated image asset: ${mediaMap[req.elementId]}`);
      } catch (err) {
        log.warn(`Image generation failed for ${req.elementId}:`, err);
      }
    }
  };

  const generateVideos = async () => {
    for (const req of videoRequests) {
      try {
        const providerId = videoProviderIds[0] as VideoProviderId;
        assertReachAnyProviderAllowed('video', providerId);
        const apiKey = resolveVideoApiKey(providerId);
        if (!apiKey) {
          log.warn(`No API key for video provider "${providerId}", skipping ${req.elementId}`);
          continue;
        }
        // No client model here — the server-side `VIDEO_<PREFIX>_MODELS` pin
        // (first entry) is authoritative when set; otherwise fall back to the
        // first catalog model so key-only deployments keep generating. This
        // path is internal (no HTTP response to fail loud with), so the
        // adapter's requireModel must stay a backstop, never the primary
        // failure mode.
        const providerConfig = VIDEO_PROVIDERS[providerId];
        const model = managedVideoModels
          ? managedVideoModels[0]
          : (resolveVideoModel(providerId) ?? providerConfig?.models?.[0]?.id);
        if (managedVideoModels && !model) {
          log.warn(`No ReachAny video model is available, skipping ${req.elementId}`);
          continue;
        }
        await assertReachAnyManagedModelAllowed('video_generation', 'video', providerId, model);

        const normalized = normalizeVideoOptions(providerId, {
          prompt: req.prompt,
          aspectRatio: (req.aspectRatio as '16:9' | '4:3' | '1:1' | '9:16') || '16:9',
        });

        const result = await generateVideo(
          { providerId, apiKey, baseUrl: resolveVideoBaseUrl(providerId), model },
          normalized,
        );

        const buf = await downloadToBuffer(result.url);
        mediaMap[req.elementId] = await putServerAssetBytes({
          principal: coursePrincipal ?? '',
          bytes: buf,
          mime: 'video/mp4',
          meta: { stageId: classroomId, source: 'classroom-video', prompt: req.prompt },
        });
        log.info(`Generated video asset: ${mediaMap[req.elementId]}`);
      } catch (err) {
        log.warn(`Video generation failed for ${req.elementId}:`, err);
      }
    }
  };

  await Promise.all([generateImages(), generateVideos()]);

  return mediaMap;
}

// ---------------------------------------------------------------------------
// Placeholder replacement in scene content
// ---------------------------------------------------------------------------

export function replaceMediaPlaceholders(scenes: Scene[], mediaMap: Record<string, string>): void {
  if (Object.keys(mediaMap).length === 0) return;

  for (const scene of scenes) {
    if (scene.type !== 'slide') continue;
    const canvas = (
      scene.content as {
        canvas?: {
          elements?: Array<{ id: string; src?: string; mediaRef?: string; type?: string }>;
        };
      }
    )?.canvas;
    if (!canvas?.elements) continue;

    for (const el of canvas.elements) {
      if (
        el.type === 'video' &&
        typeof el.mediaRef === 'string' &&
        mediaMap[el.mediaRef] &&
        (!el.src || /^gen_vid_[\w-]+$/i.test(el.src))
      ) {
        el.src = mediaMap[el.mediaRef];
        continue;
      }
      if (
        (el.type === 'image' || el.type === 'video') &&
        typeof el.src === 'string' &&
        isGeneratedMediaPlaceholder(el.src) &&
        mediaMap[el.src]
      ) {
        el.src = mediaMap[el.src];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TTS generation
// ---------------------------------------------------------------------------

export async function generateTTSForClassroom(
  scenes: Scene[],
  classroomId: string,
  baseUrl: string,
  coursePrincipal?: string,
): Promise<void> {
  void baseUrl;

  // Resolve TTS provider (exclude browser-native-tts and operator force-disabled
  // providers — server precedence, #665).
  const ttsProviderIds = Object.entries(getServerTTSProviders())
    .filter(([id, info]) => id !== 'browser-native-tts' && !info.disabled)
    .map(([id]) => id);
  if (ttsProviderIds.length === 0) {
    log.warn('No server TTS provider configured, skipping TTS generation');
    return;
  }

  const providerId = ttsProviderIds[0] as TTSProviderId;
  assertReachAnyProviderAllowed('tts', providerId);
  const apiKey = resolveTTSApiKey(providerId);
  const ttsProvider = TTS_PROVIDERS[providerId as keyof typeof TTS_PROVIDERS];
  if (ttsProvider?.requiresApiKey && !apiKey) {
    log.warn(`No API key for TTS provider "${providerId}", skipping TTS generation`);
    return;
  }
  const ttsBaseUrl = resolveTTSBaseUrl(providerId) || ttsProvider?.defaultBaseUrl;
  const voice = DEFAULT_TTS_VOICES[providerId as keyof typeof DEFAULT_TTS_VOICES] || 'default';
  const managedSpeechModels = isReachAnyManagedOnlyDeployment()
    ? await getReachAnyManagedModels('audio_speech')
    : undefined;
  const ttsModel = managedSpeechModels
    ? (managedSpeechModels[0] ?? '')
    : DEFAULT_TTS_MODELS[providerId as keyof typeof DEFAULT_TTS_MODELS] || '';
  await assertReachAnyManagedModelAllowed('audio_speech', 'tts', providerId, ttsModel);
  if (providerId === VOXCPM_TTS_PROVIDER_ID && voice === VOXCPM_AUTO_VOICE_ID) {
    log.warn('VoxCPM Auto Voice requires agent context; skipping server-side TTS generation');
    return;
  }

  for (const scene of scenes) {
    if (!scene.actions) continue;

    // Split long speech actions into multiple shorter ones before TTS generation,
    // mirroring the client-side approach. Each sub-action gets its own audio file.
    scene.actions = splitLongSpeechActions(scene.actions, providerId);

    for (const action of scene.actions) {
      if (action.type !== 'speech' || !(action as SpeechAction).text) continue;
      const speechAction = action as ServerTransportSpeechAction;
      try {
        const result = await generateTTS(
          {
            providerId,
            modelId: ttsModel,
            apiKey,
            baseUrl: ttsBaseUrl,
            voice,
            speed: speechAction.speed,
          },
          speechAction.text,
        );

        speechAction.audioId = await putServerAssetBytes({
          principal: coursePrincipal ?? '',
          bytes: Buffer.from(result.audio),
          mime:
            result.format === 'wav'
              ? 'audio/wav'
              : result.format === 'ogg'
                ? 'audio/ogg'
                : 'audio/mpeg',
          meta: { stageId: classroomId, source: 'classroom-tts', voice },
        });
        delete speechAction.audioUrl;
        log.info(`Generated TTS asset: ${speechAction.audioId} (${result.audio.length} bytes)`);
      } catch (err) {
        log.warn(`TTS generation failed for action ${action.id}:`, err);
      }
    }
  }
}
