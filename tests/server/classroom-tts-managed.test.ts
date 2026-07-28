import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from '@/lib/types/stage';

const mocks = vi.hoisted(() => ({
  generateTTS: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    mkdir: mocks.mkdir,
    writeFile: mocks.writeFile,
  },
}));

vi.mock('@/lib/audio/tts-providers', () => ({ generateTTS: mocks.generateTTS }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/server/classroom-storage', () => ({ CLASSROOMS_DIR: 'C:/ignored-classrooms' }));
vi.mock('@/lib/store/media-generation', () => ({ isMediaPlaceholder: () => false }));
vi.mock('@/lib/server/provider-config', () => ({
  getServerTTSProviders: () => ({ 'doubao-tts': { models: ['seed-tts-2.0'] } }),
  resolveTTSApiKey: () => 'openmaic-service-token',
  resolveTTSBaseUrl: () => 'http://model-service:8100/v1/volcengine/tts',
  resolveTTSModel: () => 'seed-tts-2.0',
  isReachAnyManagedTTSProxy: () => true,
  getServerImageProviders: () => ({}),
  getServerVideoProviders: () => ({}),
  resolveImageApiKey: () => '',
  resolveImageBaseUrl: () => undefined,
  resolveVideoApiKey: () => '',
  resolveVideoBaseUrl: () => undefined,
}));

describe('classroom managed TTS generation', () => {
  beforeEach(() => {
    mocks.generateTTS.mockReset();
    mocks.mkdir.mockReset();
    mocks.writeFile.mockReset();
    mocks.generateTTS.mockResolvedValue({ audio: new Uint8Array([1, 2]), format: 'mp3' });
  });

  it('uses the managed proxy flag and operator resource ID outside the API route', async () => {
    const { generateTTSForClassroom } = await import('@/lib/server/classroom-media-generation');
    const scenes = [
      {
        id: 'scene-1',
        stageId: 'stage-1',
        type: 'slide',
        title: 'Scene',
        order: 1,
        content: { type: 'slide', canvas: { id: 'canvas-1', elements: [] } },
        actions: [{ id: 'speech-1', type: 'speech', text: '你好', speed: 1 }],
      } as unknown as Scene,
    ];

    await generateTTSForClassroom(scenes, 'classroom-1', 'http://127.0.0.1:3002');

    expect(mocks.generateTTS).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'doubao-tts',
        apiKey: 'openmaic-service-token',
        baseUrl: 'http://model-service:8100/v1/volcengine/tts',
        modelId: 'seed-tts-2.0',
        providerOptions: { serverManagedProxy: true },
      }),
      '你好',
    );
    expect(mocks.writeFile).toHaveBeenCalledOnce();
  });
});
