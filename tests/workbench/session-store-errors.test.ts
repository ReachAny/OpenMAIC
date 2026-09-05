import { describe, expect, it } from 'vitest';
import { workbenchApiFailureDetails } from '@/lib/workbench/session-store';

describe('workbench API failure details', () => {
  it('unwraps ReachAcademy nested errors', () => {
    expect(
      workbenchApiFailureDetails({
        error: { code: 'MODEL_UNAVAILABLE', message: 'No managed model is configured' },
      }),
    ).toEqual({
      message: 'No managed model is configured',
      errorCode: 'MODEL_UNAVAILABLE',
    });
  });

  it('keeps flat legacy fields readable and never stringifies objects', () => {
    expect(
      workbenchApiFailureDetails({
        error: 'request rejected',
        errorCode: 'REJECTED',
      }),
    ).toEqual({ message: 'request rejected', errorCode: 'REJECTED' });
    expect(workbenchApiFailureDetails({ error: { detail: 'opaque' } }).message).toBeNull();
    expect(String(workbenchApiFailureDetails({ error: { detail: 'opaque' } }).message)).not.toContain(
      '[object Object]',
    );
  });
});
