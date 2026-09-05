import { describe, expect, it } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { assembleRunnerTools } from '@/lib/server/agent-runtime/runner-contract';

function tool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: `tool-${name}`,
    execute: async () => ({ content: [] }),
  } as unknown as AgentTool;
}

describe('assembleRunnerTools', () => {
  it('filters by the code-owned profile and preserves group order', () => {
    const tools = assembleRunnerTools(
      'teacher.material-extract',
      async () => undefined,
      { surface: 'control', tools: [tool('a')] },
      { surface: 'document', tools: [tool('denied')] },
      { surface: 'material', tools: [tool('b')] },
      { surface: 'asset', tools: [tool('c')] },
    );
    expect(tools.map((t) => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('checkpoints immediately before and after every registered call', async () => {
    const checkpoints: string[] = [];
    const executed = tool('write');
    executed.execute = async () => {
      checkpoints.push('execute');
      return { content: [], details: {} };
    };
    const [wrapped] = assembleRunnerTools(
      'teacher.agent-authoring',
      async () => {
        checkpoints.push('checkpoint');
      },
      { surface: 'skill', tools: [executed] },
    );
    await wrapped!.execute('call', {} as never);
    expect(checkpoints).toEqual(['checkpoint', 'execute', 'checkpoint']);
  });
});
