import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Keep the in-handler boundary explicit. Middleware only checks cookie
 * presence, so every session-classified route must invoke the bridge itself
 * before touching request data, providers, or persistence.
 */
const SESSION_HANDLERS = [
  'app/api/generate/agent-profiles/route.ts',
  'app/api/generate/image/route.ts',
  'app/api/generate/scene-actions/route.ts',
  'app/api/generate/scene-content/route.ts',
  'app/api/generate/scene-outlines-stream/route.ts',
  'app/api/generate/tts/route.ts',
  'app/api/generate/video/route.ts',
  'app/api/generate/voice/route.ts',
  'app/api/web-search/route.ts',
  'app/api/parse-pdf/route.ts',
  'app/api/transcription/route.ts',
  'app/api/extract-document/route.ts',
  'app/api/provider/probe-models/route.ts',
  'app/api/comfyui-workflows/route.ts',
  'app/api/quiz-grade/route.ts',
  'app/api/pbl/v2/evaluate/route.ts',
  'app/api/pbl/v2/instructor/route.ts',
  'app/api/pbl/v2/open-task/route.ts',
  'app/api/pbl/v2/simulator/route.ts',
  'app/api/pbl/v2/task/update/route.ts',
  'app/api/export-video/capability/route.ts',
  'app/api/export-video/render/route.ts',
  'app/api/export-video/render/[jobId]/route.ts',
  'app/api/export-video/render/[jobId]/download/route.ts',
  'app/api/verify-model/route.ts',
  'app/api/verify-image-provider/route.ts',
  'app/api/verify-pdf-provider/route.ts',
  'app/api/verify-video-provider/route.ts',
  'app/api/server-providers/route.ts',
  'app/api/usage/route.ts',
  'app/api/agent/runtime/route.ts',
  'app/api/stages/[id]/status/route.ts',
  'app/api/openmaic/publish/start/route.ts',
] as const;

describe('OpenMAIC session handler guard coverage', () => {
  it('keeps every classified handler wired to the bridge guard', () => {
    const missing = SESSION_HANDLERS.filter((file) => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      return !/(?:requireOpenMaicRoute|authorizeOpenMaicRequest|withRequestOwnerId)/u.test(source);
    });
    expect(missing).toEqual([]);
  });
});
