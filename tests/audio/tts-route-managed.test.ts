import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateTTS: vi.fn(),
  recordGenerationUsage: vi.fn(),
  managed: true,
  managedProxy: true,
}));

vi.mock('@/lib/audio/tts-providers', () => ({
  generateTTS: mocks.generateTTS,
  TTSRateLimitError: class TTSRateLimitError extends Error {},
}));

vi.mock('@/lib/server/usage-storage', () => ({
  recordGenerationUsage: mocks.recordGenerationUsage,
}));

vi.mock('@/lib/server/provider-config', () => ({
  isServerConfiguredProvider: () => mocks.managed,
  isServerTTSProviderDisabled: () => false,
  isReachAnyManagedTTSProxy: () => mocks.managedProxy,
  resolveTTSApiKey: (_providerId: string, clientKey?: string) =>
    mocks.managed ? 'server-service-token' : clientKey || '',
  resolveTTSBaseUrl: (_providerId: string, clientUrl?: string) =>
    mocks.managed ? 'http://model-service:8100/v1/volcengine/tts' : clientUrl,
  resolveTTSModel: (_providerId: string, model?: string) => model,
}));

vi.mock('@/lib/server/ssrf-guard', () => ({ validateUrlForSSRF: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/server/api-response', () => ({
  apiSuccess: (data: unknown) => ({ ok: true, data }),
  apiError: (code: string, status: number, message: string) => ({
    ok: false,
    code,
    status,
    message,
  }),
}));

describe('TTS route managed Doubao proxy auth', () => {
  beforeEach(() => {
    mocks.generateTTS.mockReset();
    mocks.recordGenerationUsage.mockReset();
    mocks.managed = true;
    mocks.managedProxy = true;
    mocks.generateTTS.mockResolvedValue({ audio: new Uint8Array([1, 2]), format: 'mp3' });
  });

  it('derives managed proxy mode on the server and overrides client provider options', async () => {
    const { POST } = await import('@/app/api/generate/tts/route');
    await POST({
      json: async () => ({
        text: '你好',
        audioId: 'audio-1',
        ttsProviderId: 'doubao-tts',
        ttsModelId: 'seed-tts-2.0',
        ttsVoice: 'zh_female_vv_uranus_bigtts',
        ttsApiKey: 'client-key-must-be-ignored',
        ttsBaseUrl: 'https://client.example.com',
        ttsProviderOptions: { serverManagedProxy: false, clientOption: 'preserved' },
      }),
    } as never);

    expect(mocks.generateTTS).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'doubao-tts',
        apiKey: 'server-service-token',
        baseUrl: 'http://model-service:8100/v1/volcengine/tts',
        modelId: 'seed-tts-2.0',
        providerOptions: {
          serverManagedProxy: true,
          clientOption: 'preserved',
        },
      }),
      '你好',
    );
  });

  it('cannot be tricked into Bearer proxy auth for an unmanaged client URL', async () => {
    mocks.managed = false;
    mocks.managedProxy = false;
    const { POST } = await import('@/app/api/generate/tts/route');
    await POST({
      json: async () => ({
        text: 'hello',
        audioId: 'audio-2',
        ttsProviderId: 'doubao-tts',
        ttsVoice: 'voice',
        ttsApiKey: 'app:access',
        ttsBaseUrl: 'https://openspeech.bytedance.com/api/v3/tts',
        ttsProviderOptions: { serverManagedProxy: true },
      }),
    } as never);

    expect(mocks.generateTTS).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: { serverManagedProxy: false },
      }),
      'hello',
    );
  });

  it('keeps direct Volcengine auth for a generic server-managed Doubao provider', async () => {
    mocks.managed = true;
    mocks.managedProxy = false;
    const { POST } = await import('@/app/api/generate/tts/route');
    await POST({
      json: async () => ({
        text: '你好',
        audioId: 'audio-3',
        ttsProviderId: 'doubao-tts',
        ttsVoice: 'voice',
      }),
    } as never);

    expect(mocks.generateTTS).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: { serverManagedProxy: false },
      }),
      '你好',
    );
  });
});
