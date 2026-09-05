import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('classroom exit wiring', () => {
  it.each(['components/header.tsx', 'components/edit/EditShell/CommandBar.tsx'])(
    '%s uses the shared exit helper and has no hardcoded home push',
    (path) => {
      const text = source(path);
      // The host return URL is part of the decision, not an extra branch at the call site: a
      // ReachAcademy-launched course exits to the course page, and only the helper knows that.
      expect(text).toContain('exitClassroom(router, searchParams, hostReturnUrl)');
      expect(text).toContain('classroomExitLabelKey(searchParams, hostReturnUrl)');
      expect(text).toContain('useOpenMaicHostReturnUrl()');
      expect(text).toContain('aria-label={exitLabel}');
      expect(text).not.toContain("router.push('/')");
      expect(text).not.toContain("title={t('generation.backToHome')}");
    },
  );
});
