/**
 * Sora / OpenAI-compatible video generation adapter.
 *
 * Uses the asynchronous Videos API exposed by OpenAI and LiteLLM:
 * POST /videos -> GET /videos/{id} -> GET /videos/{id}/content.
 */

import type {
  VideoGenerationConfig,
  VideoGenerationOptions,
  VideoGenerationResult,
} from '../types';
import { probeAuth } from '../probe-auth';
import { runPolledTask } from '../polled-task';

const DEFAULT_MODEL = 'sora-2';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_DURATION = 4;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60;

interface SoraVideoResponse {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | string;
  seconds?: string | number;
  size?: string;
  error?: { message?: string } | string | null;
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    ...authHeaders(apiKey),
    'Content-Type': 'application/json',
  };
}

function resolveSize(aspectRatio?: VideoGenerationOptions['aspectRatio']): string {
  switch (aspectRatio) {
    case '9:16':
      return '720x1280';
    case '1:1':
      return '720x720';
    default:
      return '1280x720';
  }
}

function parseDimensions(size: string): { width: number; height: number } {
  const [width, height] = size.split('x').map(Number);
  if (!width || !height) return { width: 1280, height: 720 };
  return { width, height };
}

function errorMessage(error: SoraVideoResponse['error']): string {
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && error.message) return error.message;
  return 'Unknown error';
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function submitVideo(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
): Promise<string> {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/videos`, {
    method: 'POST',
    headers: jsonHeaders(config.apiKey),
    body: JSON.stringify({
      model: config.model || DEFAULT_MODEL,
      prompt: options.prompt,
      seconds: String(options.duration || DEFAULT_DURATION),
      size: resolveSize(options.aspectRatio),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Sora video submission failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as SoraVideoResponse;
  if (!data.id) throw new Error('Sora returned empty video ID');
  return data.id;
}

async function pollVideo(
  config: VideoGenerationConfig,
  videoId: string,
): Promise<SoraVideoResponse> {
  const response = await fetch(
    `${normalizeBaseUrl(config.baseUrl)}/videos/${encodeURIComponent(videoId)}`,
    { headers: authHeaders(config.apiKey) },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Sora video poll failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<SoraVideoResponse>;
}

async function downloadVideo(config: VideoGenerationConfig, videoId: string): Promise<string> {
  const response = await fetch(
    `${normalizeBaseUrl(config.baseUrl)}/videos/${encodeURIComponent(videoId)}/content`,
    { headers: authHeaders(config.apiKey) },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Sora video download failed (${response.status}): ${text}`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'video/mp4';
  return `data:${mimeType};base64,${bytesToBase64(await response.arrayBuffer())}`;
}

export async function testSoraConnectivity(
  config: VideoGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  return probeAuth({
    providerName: 'Sora',
    request: () =>
      fetch(`${normalizeBaseUrl(config.baseUrl)}/videos/connectivity-test-nonexistent`, {
        method: 'GET',
        redirect: 'manual',
        headers: authHeaders(config.apiKey),
      }),
  });
}

export async function generateWithSora(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
): Promise<VideoGenerationResult> {
  const requestedSize = resolveSize(options.aspectRatio);

  return runPolledTask<VideoGenerationResult>({
    submit: async () => ({
      status: 'submitted',
      taskId: await submitVideo(config, options),
    }),
    poll: async (videoId) => {
      const video = await pollVideo(config, videoId);

      if (video.status === 'completed') {
        const size = video.size || requestedSize;
        const dimensions = parseDimensions(size);
        return {
          status: 'done',
          result: {
            url: await downloadVideo(config, videoId),
            duration: Number(video.seconds) || options.duration || DEFAULT_DURATION,
            ...dimensions,
          },
        };
      }

      if (video.status === 'failed') {
        return {
          status: 'failed',
          message: `Sora video generation failed: ${errorMessage(video.error)}`,
        };
      }

      if (video.status !== 'queued' && video.status !== 'in_progress') {
        return {
          status: 'failed',
          message: `Sora video generation returned unsupported status: ${video.status}`,
        };
      }

      return { status: 'pending' };
    },
    intervalMs: POLL_INTERVAL_MS,
    maxAttempts: MAX_POLL_ATTEMPTS,
    label: 'Sora video generation',
    formatTimeout: ({ taskId, elapsedMs }) =>
      `Sora video generation timed out after ${elapsedMs / 1000}s (video: ${taskId})`,
  });
}
