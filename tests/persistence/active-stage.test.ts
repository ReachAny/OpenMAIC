import { afterEach, describe, expect, it, vi } from 'vitest';

import { activeStageHeaders, readActiveStageIdFromLocation } from '@/lib/persistence/active-stage';

function atLocation(pathname: string, search: string): void {
  vi.stubGlobal('window', { location: { pathname, search } });
}

describe('active stage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads every page shape that carries a stage', () => {
    atLocation('/classroom/stage-1', '');
    expect(readActiveStageIdFromLocation()).toBe('stage-1');

    atLocation('/workspace', '?course=stage-pro-1');
    expect(readActiveStageIdFromLocation()).toBe('stage-pro-1');

    atLocation('/', '?stageId=stage-launch-1&mode=edit');
    expect(readActiveStageIdFromLocation()).toBe('stage-launch-1');

    // The generation flow inherits the launch entry's stage id; without it the
    // deck it produces is written under no grant at all.
    atLocation('/generation-preview', '?stageId=stage-gen-1');
    expect(readActiveStageIdFromLocation()).toBe('stage-gen-1');
  });

  it('percent-decodes a classroom path segment', () => {
    atLocation(`/classroom/${encodeURIComponent('stage/one')}`, '');
    expect(readActiveStageIdFromLocation()).toBe('stage/one');
  });

  it('reports no stage off the browser or on a page that carries none', () => {
    expect(readActiveStageIdFromLocation()).toBeNull();
    atLocation('/workspace', '');
    expect(readActiveStageIdFromLocation()).toBeNull();
  });

  it('omits the header entirely rather than sending an empty stage id', () => {
    atLocation('/', '?stageId=stage-launch-1');
    expect(activeStageHeaders()).toEqual({ 'x-openmaic-stage-id': 'stage-launch-1' });

    atLocation('/', '');
    expect(activeStageHeaders()).toEqual({});
  });
});
