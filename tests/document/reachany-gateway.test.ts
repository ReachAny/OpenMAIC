import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWithReachAny } from '@/lib/pdf/reachany';

describe('ReachAny document gateway', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads a PDF with managed auth and maps normalized images', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Authorization: 'Bearer managed-token' });
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(
        JSON.stringify({
          text: '# Lesson',
          images: [
            {
              id: 'img_1',
              page_number: 2,
              mime_type: 'image/png',
              data: 'AQID',
              description: 'Diagram',
              width: 640,
              height: 480,
            },
          ],
          metadata: { page_count: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await parseWithReachAny(
      {
        providerId: 'reachany',
        apiKey: 'managed-token',
        baseUrl: 'http://model-service:8100',
      },
      Buffer.from('%PDF'),
      { fileName: 'lesson.pdf', mimeType: 'application/pdf' },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://model-service:8100/v1/document/extractions',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.text).toBe('# Lesson');
    expect(result.metadata?.pageCount).toBe(3);
    expect(result.metadata?.pdfImages).toEqual([
      expect.objectContaining({
        id: 'img_1',
        src: 'data:image/png;base64,AQID',
        pageNumber: 2,
        description: 'Diagram',
      }),
    ]);
  });
});
