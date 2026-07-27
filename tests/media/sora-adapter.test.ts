import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateWithSora } from '@/lib/media/adapters/sora-adapter';
import { generateVideo, testVideoConnectivity } from '@/lib/media/video-providers';

const fetchMock = vi.fn();

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sora adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('submits, polls, and downloads authenticated video content as a data URL', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'video_123', status: 'queued' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'video_123', status: 'in_progress', progress: 40 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'video_123',
          status: 'completed',
          seconds: '8',
          size: '720x1280',
        }),
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([0, 1, 2, 3]), {
          headers: { 'Content-Type': 'video/mp4; charset=binary' },
        }),
      );

    const promise = generateWithSora(
      {
        providerId: 'sora',
        apiKey: 'model-service-token',
        baseUrl: 'https://model.example.com/v1/',
        model: 'sora-proxy-alias',
      },
      { prompt: 'a paper city unfolding', duration: 8, aspectRatio: '9:16' },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://model.example.com/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer model-service-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sora-proxy-alias',
        prompt: 'a paper city unfolding',
        seconds: '8',
        size: '720x1280',
      }),
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://model.example.com/v1/videos/video_123', {
      headers: { Authorization: 'Bearer model-service-token' },
    });

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toEqual({
      url: 'data:video/mp4;base64,AAECAw==',
      duration: 8,
      width: 720,
      height: 1280,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://model.example.com/v1/videos/video_123/content',
      { headers: { Authorization: 'Bearer model-service-token' } },
    );
  });

  it('uses the Sora defaults through the shared generateVideo switch', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'video_default', status: 'queued' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'video_default',
          status: 'completed',
          seconds: 4,
          size: '1280x720',
        }),
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([115, 111, 114, 97]), {
          headers: { 'Content-Type': 'video/webm' },
        }),
      );

    const promise = generateVideo(
      { providerId: 'sora', apiKey: 'sora-key' },
      { prompt: 'default request' },
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      model: 'sora-2',
      prompt: 'default request',
      seconds: '4',
      size: '1280x720',
    });

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toEqual({
      url: 'data:video/webm;base64,c29yYQ==',
      duration: 4,
      width: 1280,
      height: 720,
    });
  });

  it('surfaces failed generation details', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'video_failed', status: 'queued' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'video_failed',
          status: 'failed',
          error: { message: 'content rejected' },
        }),
      );

    const promise = generateWithSora(
      { providerId: 'sora', apiKey: 'sora-key' },
      { prompt: 'blocked request' },
    );
    const rejection = expect(promise).rejects.toThrow(
      'Sora video generation failed: content rejected',
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('registers the non-generating connectivity probe in the shared switch', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }));

    await expect(
      testVideoConnectivity({
        providerId: 'sora',
        apiKey: 'model-service-token',
        baseUrl: 'https://model.example.com/v1/',
      }),
    ).resolves.toEqual({ success: true, message: 'Connected to Sora' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://model.example.com/v1/videos/connectivity-test-nonexistent',
      {
        method: 'GET',
        redirect: 'manual',
        headers: { Authorization: 'Bearer model-service-token' },
      },
    );
  });
});
