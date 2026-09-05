import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { enumerateAssetManifest, slideMediaSlotDescriptors } from '@openmaic/dsl';

import fixture from '../fixtures/openmaic-asset-reference-v1.json';
import {
  ASSET_REFERENCE_REF_TYPES,
  ASSET_REFERENCE_SLOT_KINDS,
  OPENMAIC_ASSET_REFERENCE_SPEC,
  canonicalizeLegacyClassroomMedia,
  collectOpenMaicAssetReferences,
  deterministicAssetReferenceId,
  rewriteOpenMaicAssetReferences,
} from '@/lib/reachacademy/asset-reference-spec';

describe('ReachAcademy OpenMAIC asset reference spec', () => {
  it('is byte-for-byte mirrored at the repository and fork boundaries', () => {
    const fork = readFileSync(resolve('openmaic-asset-reference-spec/v1.json'), 'utf8');
    const root = readFileSync(resolve('../..', 'openmaic-asset-reference-spec/v1.json'), 'utf8');
    expect(JSON.parse(fork)).toEqual(JSON.parse(root));
    expect(OPENMAIC_ASSET_REFERENCE_SPEC.slotKinds).toEqual(ASSET_REFERENCE_SLOT_KINDS);
    expect(OPENMAIC_ASSET_REFERENCE_SPEC.refTypes).toEqual(ASSET_REFERENCE_REF_TYPES);
  });

  it('covers every DSL slide role and complete document closure exactly', () => {
    const slide = fixture.document.stage.whiteboard[0];
    const dslRoles = [...slideMediaSlotDescriptors(slide as never)].map((slot) => slot.kind);
    expect(OPENMAIC_ASSET_REFERENCE_SPEC.slideRoles.map((role) => role.role)).toEqual(dslRoles);

    const collected = collectOpenMaicAssetReferences(fixture.document);
    const specRefs = new Set(collected.map((entry) => entry.ref));
    const manifestRefs = new Set(
      enumerateAssetManifest(fixture.document as never).entries.map((entry) => entry.ref),
    );
    expect(specRefs).toEqual(manifestRefs);
    expect(collected.map((entry) => entry.slotRole)).toContain('stage-video-manifest');
    expect(collected.map((entry) => entry.slotRole)).toContain('speech-audio-url');
    expect(collected.some((entry) => entry.ref === 'https://ignored.example/a.png')).toBe(false);
  });

  it('derives stable domain-separated IDs for all ref types and destination legs', () => {
    for (const leg of ['draft', 'published'] as const) {
      const targetStageId = fixture.targetStages[leg];
      for (const refType of ASSET_REFERENCE_REF_TYPES) {
        const fixtureKey =
          refType === 'asset-id'
            ? 'asset'
            : refType === 'legacy-classroom-media'
              ? 'legacy'
              : 'provider';
        expect(
          deterministicAssetReferenceId({
            refType,
            targetStageId,
            sourceRef: fixture.sourceRefs[fixtureKey],
          }),
        ).toBe(fixture.expectedIds[leg][fixtureKey]);
      }
    }
    expect(fixture.expectedIds.draft.asset).not.toBe(fixture.expectedIds.published.asset);
  });

  it('rewrites value and key-set slots without touching discriminator mismatches', () => {
    const replacements = new Map([
      [fixture.sourceRefs.asset, fixture.expectedIds.draft.asset],
      [fixture.sourceRefs.legacy, fixture.expectedIds.draft.legacy],
      [fixture.sourceRefs.provider, fixture.expectedIds.draft.provider],
      ['/api/classroom-media/source-stage/audio/speech.mp3', 'ast_00000000000000000000000000'],
    ]);
    const rewritten = rewriteOpenMaicAssetReferences(fixture.document, replacements);
    expect(Object.keys(rewritten.stage.videoManifest)).toEqual([
      fixture.expectedIds.draft.provider,
    ]);
    expect(rewritten.scenes[0]!.actions![0]!).toMatchObject({
      audioId: fixture.expectedIds.draft.asset,
    });
    expect(rewritten.scenes[0]!.actions![0]!).not.toHaveProperty('audioUrl');
    expect(rewritten.scenes[0]!.actions![1]!.audioId).toBe('ignored');
    expect(rewritten.scenes[1]!.content.canvas.elements[0]!.src).toBe(
      'https://ignored.example/a.png',
    );
  });

  it('normalizes only stage-bound trusted legacy paths and fails closed otherwise', () => {
    expect(canonicalizeLegacyClassroomMedia(fixture.sourceRefs.legacy)).toEqual({
      urlStageId: 'source-stage',
      relativePath: 'media/legacy.png',
    });
    expect(
      canonicalizeLegacyClassroomMedia(
        'http://localhost:3000/api/classroom-media/source-stage/media/legacy.png',
        { allowLegacyLocalhostImport: true },
      ),
    ).toEqual({ urlStageId: 'source-stage', relativePath: 'media/legacy.png' });
    expect(
      canonicalizeLegacyClassroomMedia(
        'https://foreign.example/api/classroom-media/source-stage/media/legacy.png',
      ),
    ).toBeNull();
    expect(
      canonicalizeLegacyClassroomMedia('/api/classroom-media/source-stage/media/../secret'),
    ).toBeNull();
  });
});
