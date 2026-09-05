import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  put: vi.fn().mockResolvedValue('ast_generated_media'),
}));

vi.mock('@/lib/server/server-asset-bytes', () => ({ putServerAssetBytes: mocks.put }));

import { persistClassroomMediaBytes } from '@/lib/server/classroom-media-bytes';

/**
 * Generated media is a course-scoped registry entry, never a pod-local URL.
 */
describe('persistClassroomMediaBytes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the allocated asset id and forwards the course principal', async () => {
    const ref = await persistClassroomMediaBytes({
      stageId: 'stage-owner',
      coursePrincipal: 'reachacademy:org:org-a:course:course-a',
      bytes: Buffer.from('real-media-bytes'),
      mime: 'image/png',
      prefix: 'generated',
    });

    expect(ref).toBe('ast_generated_media');
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: 'reachacademy:org:org-a:course:course-a',
        meta: { stageId: 'stage-owner', source: 'generated' },
      }),
    );
  });

  it('preserves media bytes, MIME and provenance metadata', async () => {
    const bytes = Buffer.from('real-media-bytes');
    await persistClassroomMediaBytes({
      stageId: 'stage-owner',
      coursePrincipal: 'reachacademy:org:org-a:course:course-a',
      bytes,
      mime: 'audio/mpeg',
      prefix: 'tts-speech-a',
      signal: new AbortController().signal,
    });

    expect(mocks.put).toHaveBeenCalledWith({
      principal: 'reachacademy:org:org-a:course:course-a',
      bytes,
      mime: 'audio/mpeg',
      meta: { stageId: 'stage-owner', source: 'tts-speech-a' },
      signal: expect.any(AbortSignal),
    });
  });

  it('honors a pre-aborted signal before any I/O', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      persistClassroomMediaBytes({
        stageId: 'stage-owner',
        coursePrincipal: 'reachacademy:org:org-a:course:course-a',
        bytes: Buffer.from('x'),
        mime: 'image/png',
        signal: controller.signal,
      }),
    ).rejects.toThrow('aborted');
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
