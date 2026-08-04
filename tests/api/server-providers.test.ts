import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchModels: vi.fn(),
  getServerProviders: vi.fn(),
  getServerTTSProviders: vi.fn(),
  getServerASRProviders: vi.fn(),
  getServerPDFProviders: vi.fn(),
  getServerImageProviders: vi.fn(),
  getServerVideoProviders: vi.fn(),
  getServerWebSearchProviders: vi.fn(),
}));

vi.mock('@/lib/server/model-fetch', () => ({
  fetchModels: mocks.fetchModels,
}));

vi.mock('@/lib/server/provider-config', () => ({
  getServerProviders: mocks.getServerProviders,
  getServerTTSProviders: mocks.getServerTTSProviders,
  getServerASRProviders: mocks.getServerASRProviders,
  getServerPDFProviders: mocks.getServerPDFProviders,
  getServerImageProviders: mocks.getServerImageProviders,
  getServerVideoProviders: mocks.getServerVideoProviders,
  getServerWebSearchProviders: mocks.getServerWebSearchProviders,
  getParallelSceneConcurrency: () => 0,
  resolveApiKey: (id: string) => `${id}-key`,
  resolveBaseUrl: (id: string) => `https://models.example/${id}/v1`,
  resolveTTSApiKey: (id: string) => `${id}-key`,
  resolveTTSBaseUrl: (id: string) => `https://models.example/${id}/v1`,
  resolveTTSCatalogBaseUrl: (id: string) => `https://catalog.example/${id}/v1`,
  resolveASRApiKey: (id: string) => `${id}-key`,
  resolveASRBaseUrl: (id: string) => `https://models.example/${id}/v1`,
  resolveImageApiKey: (id: string) => `${id}-key`,
  resolveImageBaseUrl: (id: string) => `https://models.example/${id}/v1`,
  resolveVideoApiKey: (id: string) => `${id}-key`,
  resolveVideoBaseUrl: (id: string) => `https://models.example/${id}/v1`,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('GET /api/server-providers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getServerProviders.mockReturnValue({
      openrouter: {},
      openai: { models: ['operator-pinned-chat'] },
    });
    mocks.getServerTTSProviders.mockReturnValue({ 'doubao-tts': {} });
    mocks.getServerASRProviders.mockReturnValue({ 'openai-whisper': {} });
    mocks.getServerPDFProviders.mockReturnValue({});
    mocks.getServerImageProviders.mockReturnValue({ 'openai-image': {} });
    mocks.getServerVideoProviders.mockReturnValue({ sora: {} });
    mocks.getServerWebSearchProviders.mockReturnValue({});
  });

  it('discovers every managed modality while preserving static allowlists', async () => {
    mocks.fetchModels.mockImplementation(
      async (_baseUrl: string, _apiKey: string, options: { mode: string }) => [
        { id: `${options.mode}-alias`, mode: options.mode },
        { id: `${options.mode}-alias`, mode: options.mode },
      ],
    );

    const { GET } = await import('@/app/api/server-providers/route');
    const response = await GET();
    const body = await response.json();

    expect(body.providers).toEqual({
      openrouter: { models: ['chat-alias'] },
      openai: { models: ['operator-pinned-chat'] },
    });
    expect(body.tts['doubao-tts'].models).toEqual(['audio_speech-alias']);
    expect(body.asr['openai-whisper'].models).toEqual(['audio_transcription-alias']);
    expect(body.image['openai-image'].models).toEqual(['image_generation-alias']);
    expect(body.video.sora.models).toEqual(['video_generation-alias']);
    expect(mocks.fetchModels).toHaveBeenCalledTimes(5);
    expect(mocks.fetchModels).toHaveBeenCalledWith(
      'https://catalog.example/doubao-tts/v1',
      'doubao-tts-key',
      { mode: 'audio_speech' },
    );
    expect(mocks.fetchModels).not.toHaveBeenCalledWith(
      expect.stringContaining('/openai/'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('isolates discovery failures so one modality keeps the others usable', async () => {
    mocks.fetchModels.mockImplementation(
      async (_baseUrl: string, _apiKey: string, options: { mode: string }) => {
        if (options.mode === 'image_generation') throw new Error('image catalog unavailable');
        return [{ id: `${options.mode}-alias`, mode: options.mode }];
      },
    );

    const { GET } = await import('@/app/api/server-providers/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.image).toEqual({ 'openai-image': {} });
    expect(body.video.sora.models).toEqual(['video_generation-alias']);
    expect(body.providers.openrouter.models).toEqual(['chat-alias']);
  });
});
