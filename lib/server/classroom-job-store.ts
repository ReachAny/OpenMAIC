import type {
  ClassroomGenerationProgress,
  ClassroomGenerationStep,
  GenerateClassroomInput,
  GenerateClassroomResult,
} from '@/lib/server/classroom-generation';
import { getOpenMaicRedisStore, type OpenMaicRedisStore } from '@/lib/reachacademy/bridge/redis';

export type ClassroomGenerationJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'aborted';

export interface ClassroomGenerationJob {
  id: string;
  status: ClassroomGenerationJobStatus;
  step: ClassroomGenerationStep | 'queued' | 'failed';
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  inputSummary: {
    requirementPreview: string;
    hasPdf: boolean;
    pdfTextLength: number;
    pdfImageCount: number;
  };
  scenesGenerated: number;
  totalScenes?: number;
  result?: { classroomId: string; url: string; scenesCount: number };
  error?: string;
}

const KEY_PREFIX = 'reachany:openmaic-classroom-job:';
const JOB_TTL_SECONDS = 2 * 60 * 60;
const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1_000;

function key(jobId: string): string {
  return `${KEY_PREFIX}${jobId}`;
}

function buildInputSummary(input: GenerateClassroomInput): ClassroomGenerationJob['inputSummary'] {
  return {
    requirementPreview:
      input.requirement.length > 200 ? `${input.requirement.slice(0, 197)}...` : input.requirement,
    hasPdf: !!input.pdfContent,
    pdfTextLength: input.pdfContent?.text.length || 0,
    pdfImageCount: input.pdfContent?.images.length || 0,
  };
}

function parseJob(serialized: string | null, jobId: string): ClassroomGenerationJob | null {
  if (!serialized) return null;
  try {
    const job = JSON.parse(serialized) as ClassroomGenerationJob;
    if (job.id !== jobId || !isValidClassroomJobId(job.id)) return null;
    if (!['queued', 'running', 'succeeded', 'failed', 'aborted'].includes(job.status)) return null;
    return job;
  } catch {
    return null;
  }
}

export function isValidClassroomJobId(jobId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(jobId);
}

export async function createClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
  store: OpenMaicRedisStore = getOpenMaicRedisStore(),
): Promise<ClassroomGenerationJob> {
  const now = new Date().toISOString();
  const job: ClassroomGenerationJob = {
    id: jobId,
    status: 'queued',
    step: 'queued',
    progress: 0,
    message: 'Classroom generation job queued',
    createdAt: now,
    updatedAt: now,
    inputSummary: buildInputSummary(input),
    scenesGenerated: 0,
  };
  if (!(await store.setIfAbsent(key(jobId), JSON.stringify(job), JOB_TTL_SECONDS))) {
    throw new Error(`Classroom generation job already exists: ${jobId}`);
  }
  return job;
}

export async function readClassroomGenerationJob(
  jobId: string,
  store: OpenMaicRedisStore = getOpenMaicRedisStore(),
): Promise<ClassroomGenerationJob | null> {
  const job = parseJob(await store.get(key(jobId)), jobId);
  if (!job || job.status !== 'running') return job;
  if (Date.now() - new Date(job.updatedAt).getTime() <= STALE_JOB_TIMEOUT_MS) return job;
  return {
    ...job,
    status: 'failed',
    step: 'failed',
    message: 'Job appears stale (no progress update for 30 minutes)',
    error: 'Stale job: executor stopped during generation',
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateClassroomGenerationJob(
  jobId: string,
  patch: Partial<ClassroomGenerationJob>,
  store: OpenMaicRedisStore = getOpenMaicRedisStore(),
): Promise<ClassroomGenerationJob> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const serialized = await store.get(key(jobId));
    const existing = parseJob(serialized, jobId);
    if (!serialized || !existing) throw new Error(`Classroom generation job not found: ${jobId}`);
    const updated = { ...existing, ...patch, id: jobId, updatedAt: new Date().toISOString() };
    if (
      await store.compareAndSet(key(jobId), serialized, JSON.stringify(updated), JOB_TTL_SECONDS)
    ) {
      return updated;
    }
  }
  throw new Error(`Classroom generation job update conflicted: ${jobId}`);
}

export function markClassroomGenerationJobRunning(jobId: string) {
  return updateClassroomGenerationJob(jobId, {
    status: 'running',
    startedAt: new Date().toISOString(),
    message: 'Classroom generation started',
  });
}

export function updateClassroomGenerationJobProgress(
  jobId: string,
  progress: ClassroomGenerationProgress,
) {
  return updateClassroomGenerationJob(jobId, {
    status: 'running',
    step: progress.step,
    progress: progress.progress,
    message: progress.message,
    scenesGenerated: progress.scenesGenerated,
    totalScenes: progress.totalScenes,
  });
}

export function markClassroomGenerationJobSucceeded(
  jobId: string,
  result: GenerateClassroomResult,
) {
  return updateClassroomGenerationJob(jobId, {
    status: 'succeeded',
    step: 'completed',
    progress: 100,
    message: 'Classroom generation completed',
    completedAt: new Date().toISOString(),
    scenesGenerated: result.scenesCount,
    result: { classroomId: result.id, url: result.url, scenesCount: result.scenesCount },
  });
}

export function markClassroomGenerationJobFailed(jobId: string, error: string, aborted = false) {
  return updateClassroomGenerationJob(jobId, {
    status: aborted ? 'aborted' : 'failed',
    step: 'failed',
    message: aborted ? 'Classroom generation authorization expired' : 'Classroom generation failed',
    completedAt: new Date().toISOString(),
    error,
  });
}
