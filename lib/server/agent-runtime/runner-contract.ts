import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  OPENMAIC_JOB_PROFILES,
  type OpenMaicJobProfile,
} from '@/lib/reachacademy/bridge/job-authorization';
import { courseSystemPrompt, DSL_TOOLS_PROMPT } from './course-tools';

type PromptBlocks = Parameters<typeof courseSystemPrompt>[0];

export type RunnerToolSurface =
  | 'control'
  | 'model'
  | 'agent'
  | 'document'
  | 'asset'
  | 'material'
  | 'skill';

export interface RunnerToolGroup {
  surface: RunnerToolSurface;
  tools: ReadonlyArray<AgentTool>;
}

/** Code-owned profile seam: tools outside the lease mutation surfaces never register. */
export function assembleRunnerTools(
  jobProfile: OpenMaicJobProfile,
  checkpoint: () => Promise<void>,
  ...groups: ReadonlyArray<RunnerToolGroup>
): AgentTool[] {
  const mutations = new Set<string>(OPENMAIC_JOB_PROFILES[jobProfile].mutationSurfaces);
  return groups
    .filter(({ surface }) => surface === 'control' || surface === 'model' || mutations.has(surface))
    .flatMap(({ tools }) =>
      tools.map((tool) => {
        const execute = tool.execute.bind(tool);
        return {
          ...tool,
          async execute(...args: Parameters<typeof tool.execute>) {
            await checkpoint();
            const result = await execute(...args);
            await checkpoint();
            return result;
          },
        } as AgentTool;
      }),
    );
}

/** The DSL compatibility block is part of every runner prompt. */
export function buildRunnerCoursePrompt(blocks: Omit<PromptBlocks, 'dslTools'>): string {
  return courseSystemPrompt({ ...blocks, dslTools: DSL_TOOLS_PROMPT });
}
