import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { generateTTS } from '@/lib/audio/tts-providers';
import type { TTSModelConfig } from '@/lib/audio/types';

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

describe('first-party OpenAI TTS removal', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('rejects a legacy openai-tts request without making a network call', async () => {
    const legacyConfig = {
      providerId: 'openai-tts',
      apiKey: 'legacy-key',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini-tts',
      voice: 'alloy',
    } as unknown as TTSModelConfig;

    await expect(generateTTS(legacyConfig, 'hello')).rejects.toThrow(
      'Unsupported TTS provider: openai-tts',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps custom OpenAI-compatible TTS endpoints available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });

    await generateTTS(
      {
        providerId: 'custom-tts-campus',
        apiKey: 'custom-key',
        baseUrl: 'https://tts.example/v1/',
        modelId: 'campus-voice-v1',
        voice: 'narrator',
      },
      'hello',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://tts.example/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'campus-voice-v1',
          input: 'hello',
          voice: 'narrator',
          speed: 1,
        }),
      }),
    );
  });

  it('preserves the legacy default model for a custom endpoint without a model selection', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });

    await generateTTS(
      {
        providerId: 'custom-tts-campus',
        apiKey: 'custom-key',
        baseUrl: 'https://tts.example/v1',
        voice: 'narrator',
      },
      'hello',
    );

    const request = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({ model: 'gpt-4o-mini-tts' });
  });
});
