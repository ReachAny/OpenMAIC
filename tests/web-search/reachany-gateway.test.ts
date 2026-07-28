import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchWithReachAny } from '@/lib/web-search/reachany';

describe('ReachAny web search gateway', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the normalized request and maps sources', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        Authorization: 'Bearer managed-token',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(String(init?.body))).toEqual({ query: 'water cycle', max_results: 7 });
      return new Response(
        JSON.stringify({
          query: 'water cycle',
          answer: 'Summary',
          response_time: 0.2,
          sources: [
            {
              title: 'Lesson',
              url: 'https://example.test/lesson',
              content: 'Water moves.',
              score: 0.9,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchWithReachAny({
      query: 'water cycle',
      apiKey: 'managed-token',
      maxResults: 7,
      baseUrl: 'http://model-service:8100/v1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://model-service:8100/v1/web/search',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.answer).toBe('Summary');
    expect(result.sources).toEqual([
      {
        title: 'Lesson',
        url: 'https://example.test/lesson',
        content: 'Water moves.',
        score: 0.9,
      },
    ]);
  });
});
