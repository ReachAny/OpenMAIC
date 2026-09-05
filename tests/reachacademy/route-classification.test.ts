import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

import { classifyOpenMaicApiRoute } from '@/lib/reachacademy/bridge/route-classification';

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

function samplePath(file: string): string {
  const root = join(process.cwd(), 'app');
  const segments = relative(root, file).split(sep).slice(0, -1);
  return `/${segments
    .map((segment) => {
      if (segment === '[...path]') return 'documents/stage-sample';
      if (/^\[.+\]$/.test(segment)) return 'stage-sample';
      return segment;
    })
    .join('/')}`;
}

describe('ReachAcademy API route classification', () => {
  test('classifies every exported app/api method and defaults unknown routes to deny', () => {
    const files = routeFiles(join(process.cwd(), 'app', 'api'));
    const missing = files.flatMap((file) => {
      const methods = [
        ...readFileSync(file, 'utf8').matchAll(
          /export\s+(?:async\s+function|const)\s+(GET|HEAD|POST|PUT|PATCH|DELETE)\b/g,
        ),
      ].map((match) => match[1]);
      return methods
        .filter((method) => classifyOpenMaicApiRoute(samplePath(file), method) === null)
        .map((method) => `${method} ${samplePath(file)}`);
    });
    expect(missing).toEqual([]);
    expect(classifyOpenMaicApiRoute('/api/future-unclassified', 'GET')).toBeNull();
  });

  test('uses most-specific learner/export rules and retires native publication', () => {
    expect(classifyOpenMaicApiRoute('/api/generate/tts', 'POST')).toMatchObject({
      auth: 'session',
      capabilityAlternatives: [['model.invoke'], ['model.invoke.learner']],
    });
    expect(classifyOpenMaicApiRoute('/api/export-video/capability', 'GET')).toMatchObject({
      capabilityAlternatives: [['model.invoke']],
    });
    expect(classifyOpenMaicApiRoute('/api/stages/stage-1/publish', 'POST')).toEqual({
      auth: 'retired',
    });
    // The ReachAcademy publication path replaces it: minting the intent is held to the same shape
    // as the write it leads to — a teacher, on the draft, who may write this document.
    expect(classifyOpenMaicApiRoute('/api/openmaic/publish/start', 'POST')).toEqual({
      auth: 'session',
      capabilityAlternatives: [['document.write']],
      principal: 'course',
      roles: ['teacher'],
      stages: ['draft'],
    });
    expect(classifyOpenMaicApiRoute('/api/persistence/runtime', 'DELETE')).toBeNull();
    expect(classifyOpenMaicApiRoute('/api/unknown-owner-surface', 'POST')).toBeNull();
  });

  test('keeps native publication handlers retired even without middleware', async () => {
    const [{ POST: publish }, { POST: unpublish }] = await Promise.all([
      import('@/app/api/stages/[id]/publish/route'),
      import('@/app/api/stages/[id]/unpublish/route'),
    ]);
    await expect(publish()).resolves.toMatchObject({ status: 404 });
    await expect(unpublish()).resolves.toMatchObject({ status: 404 });
  });
});
