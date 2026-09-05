import type { ParsedPdfContent } from '@/lib/types/pdf';
import type { WebSearchResult } from '@/lib/types/web-search';

export interface ReachAnyModelGatewayConfig {
  baseUrl: string;
  serviceToken: string;
}

export type ReachAnyCapabilityMode =
  | 'chat'
  | 'image_generation'
  | 'video_generation'
  | 'audio_speech'
  | 'audio_transcription';

function gatewayConfig(
  overrides?: Partial<ReachAnyModelGatewayConfig>,
): ReachAnyModelGatewayConfig {
  const baseUrl = (overrides?.baseUrl ?? process.env.REACHANY_MODEL_BASE_URL ?? '').replace(
    /\/+$/,
    '',
  );
  const serviceToken = overrides?.serviceToken ?? process.env.REACHANY_OPENMAIC_SERVICE_TOKEN ?? '';
  if (!baseUrl || !serviceToken) {
    throw new Error('ReachAny model gateway is not configured');
  }
  return { baseUrl, serviceToken };
}

async function request(
  path: string,
  init: RequestInit,
  overrides?: Partial<ReachAnyModelGatewayConfig>,
): Promise<Response> {
  const config = gatewayConfig(overrides);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${config.serviceToken}`);
  const response = await fetch(`${config.baseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(
      `ReachAny model gateway error (${response.status})${detail ? `: ${detail}` : ''}`,
    );
  }
  return response;
}

export function reachAnyOpenAiBaseUrl(overrides?: Partial<ReachAnyModelGatewayConfig>): {
  baseUrl: string;
  apiKey: string;
} {
  const config = gatewayConfig(overrides);
  return { baseUrl: `${config.baseUrl}/v1`, apiKey: config.serviceToken };
}

/** Fetch the credential-free model catalog exposed by model-service. */
export async function listReachAnyModels(
  mode: ReachAnyCapabilityMode,
  options: { signal?: AbortSignal } = {},
  overrides?: Partial<ReachAnyModelGatewayConfig>,
): Promise<string[]> {
  const response = await request(
    `/v1/models?mode=${encodeURIComponent(mode)}`,
    { method: 'GET', signal: options.signal },
    overrides,
  );
  const payload = (await response.json()) as {
    data?: Array<{ id?: string; model_name?: string }>;
  };
  return (payload.data ?? [])
    .map((item) => item.id ?? item.model_name ?? '')
    .filter((id): id is string => Boolean(id.trim()))
    .sort((a, b) => a.localeCompare(b));
}

export async function extractReachAnyDocument(
  bytes: Buffer,
  options: { fileName?: string; mimeType?: string; signal?: AbortSignal } = {},
  overrides?: Partial<ReachAnyModelGatewayConfig>,
): Promise<ParsedPdfContent> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: options.mimeType ?? 'application/pdf' }),
    options.fileName ?? 'document.pdf',
  );
  const response = await request(
    '/v1/document/extractions',
    {
      method: 'POST',
      headers: { 'X-ReachAny-Capability': 'doc.courseware.openmaic.pdf' },
      body: form,
      signal: options.signal,
    },
    overrides,
  );
  const payload = (await response.json()) as {
    id?: string;
    extractor?: string;
    text?: string;
    images?: Array<{
      id?: string;
      page_number?: number;
      mime_type?: string;
      data?: string;
      description?: string;
      width?: number;
      height?: number;
    }>;
    metadata?: { file_name?: string; file_size?: number; page_count?: number };
  };
  const images = (payload.images ?? []).filter((image) => typeof image.data === 'string');
  const pdfImages = images.map((image, index) => ({
    id: image.id ?? `image-${index + 1}`,
    src: `data:${image.mime_type ?? 'image/png'};base64,${image.data}`,
    pageNumber: image.page_number ?? 1,
    ...(image.description ? { description: image.description } : {}),
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
  }));
  return {
    text: payload.text ?? '',
    images: pdfImages.map((image) => image.src),
    metadata: {
      fileName: payload.metadata?.file_name,
      fileSize: payload.metadata?.file_size,
      pageCount: payload.metadata?.page_count ?? 0,
      parser: payload.extractor ?? 'reachany',
      taskId: payload.id,
      imageMapping: Object.fromEntries(pdfImages.map((image) => [image.id, image.src])),
      pdfImages,
    },
  };
}

export async function searchReachAnyWeb(
  query: string,
  options: { maxResults?: number; sessionId?: string; signal?: AbortSignal } = {},
  overrides?: Partial<ReachAnyModelGatewayConfig>,
): Promise<WebSearchResult> {
  const response = await request(
    '/v1/web/search',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ReachAny-Capability': 'web.courseware.openmaic.search',
      },
      body: JSON.stringify({
        query,
        max_results: options.maxResults ?? 5,
        ...(options.sessionId ? { session_id: options.sessionId } : {}),
      }),
      signal: options.signal,
    },
    overrides,
  );
  const payload = (await response.json()) as WebSearchResult;
  return {
    answer: payload.answer ?? '',
    query: payload.query ?? query,
    responseTime: Number(
      payload.responseTime ?? (payload as { response_time?: number }).response_time ?? 0,
    ),
    sources: Array.isArray(payload.sources) ? payload.sources : [],
  };
}

export async function synthesizeReachAnySpeech(
  input: { text: string; model: string; voice: string; speed?: number; signal?: AbortSignal },
  overrides?: Partial<ReachAnyModelGatewayConfig>,
): Promise<{ audio: Uint8Array; contentType: string }> {
  const response = await request(
    '/v1/audio/speech',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        input: input.text,
        voice: input.voice,
        speed: input.speed ?? 1,
      }),
      signal: input.signal,
    },
    overrides,
  );
  return {
    audio: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
  };
}
