export const STAGE_SCHEMAS = {
  draft: { schema: 'openmaic_draft', readOnly: false },
  published: { schema: 'openmaic_published', readOnly: true },
} as const;

export type StageName = keyof typeof STAGE_SCHEMAS;
export const DEFAULT_STAGE: StageName = 'draft';
export const STAGE_HEADER = 'x-openmaic-stage';

export function isStageName(value: string): value is StageName {
  return Object.hasOwn(STAGE_SCHEMAS, value);
}

export function resolveStage(request: Request): StageName | undefined {
  const url = new URL(request.url);
  const requested = url.searchParams.get('stage') ?? request.headers.get(STAGE_HEADER);
  if (requested === null || requested === '') return DEFAULT_STAGE;
  return isStageName(requested) ? requested : undefined;
}

/** Add a pinned PostgreSQL search_path without allowing an arbitrary schema name. */
export function stageConnectionString(connectionString: string, stage: StageName): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${STAGE_SCHEMAS[stage].schema}`);
  return url.toString();
}

export function schemaFromStageConnectionString(
  connectionString: string,
): 'openmaic_draft' | 'openmaic_published' | undefined {
  const options = new URL(connectionString).searchParams.get('options');
  const match = /(?:^|\s)-c\s+search_path=(openmaic_draft|openmaic_published)(?:\s|$)/.exec(
    options ?? '',
  );
  return match?.[1] as 'openmaic_draft' | 'openmaic_published' | undefined;
}
