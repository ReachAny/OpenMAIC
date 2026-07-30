import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenMAIC home surface', () => {
  it('does not load or render a shared course library', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/page.tsx'), 'utf8');

    expect(source).not.toContain('listStages');
    expect(source).not.toContain('ClassroomCard');
    expect(source).not.toContain('Recent classrooms');
  });
});
