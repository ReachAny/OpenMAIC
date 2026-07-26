import { describe, it, expect } from 'vitest';
import { isValidStageId, resolveStageId } from '@/lib/stage-id';

describe('isValidStageId', () => {
  it('accepts locally minted nanoid ids and host-supplied uuids', () => {
    expect(isValidStageId('V1StGXR8Z5')).toBe(true);
    expect(isValidStageId('c263fd73-9d0d-4891-afc8-b1c5c73a14d1')).toBe(true);
  });

  it('rejects ids that could escape a /classroom/:id path', () => {
    expect(isValidStageId('../../etc/passwd')).toBe(false);
    expect(isValidStageId('a/b')).toBe(false);
    expect(isValidStageId('a?b=1')).toBe(false);
    expect(isValidStageId('a#b')).toBe(false);
    expect(isValidStageId('a b')).toBe(false);
  });

  it('rejects empty and over-long ids', () => {
    expect(isValidStageId('')).toBe(false);
    expect(isValidStageId('a'.repeat(129))).toBe(false);
    expect(isValidStageId('a'.repeat(128))).toBe(true);
  });
});

describe('resolveStageId', () => {
  it('honours a well-formed host-supplied id so the host can navigate back', () => {
    const requested = 'c263fd73-9d0d-4891-afc8-b1c5c73a14d1';
    expect(resolveStageId(requested)).toBe(requested);
  });

  it('mints a local id when none was supplied', () => {
    const generated = resolveStageId(undefined);
    expect(generated).toHaveLength(10);
    expect(isValidStageId(generated)).toBe(true);
  });

  it('mints a local id rather than trusting a malformed one', () => {
    expect(resolveStageId('../escape')).not.toBe('../escape');
    expect(isValidStageId(resolveStageId('../escape'))).toBe(true);
    expect(isValidStageId(resolveStageId(''))).toBe(true);
  });
});
