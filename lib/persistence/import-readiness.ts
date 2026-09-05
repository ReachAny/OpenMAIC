import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const OPENMAIC_IMPORT_EVIDENCE_PATH = path.join(
  process.cwd(),
  'data',
  'migration',
  'openmaic-v1-import-evidence.json',
);

interface OpenMaicImportEvidenceV1 {
  version: 1;
  generatedAt: string;
  sourceFileCount: number;
  sourceByteCount: number;
  importedFileCount: number;
  importedByteCount: number;
  unresolvedUrls: string[];
  missingSourceRefs: string[];
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseOpenMaicImportEvidence(value: unknown): OpenMaicImportEvidenceV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const evidence = value as Partial<OpenMaicImportEvidenceV1>;
  const keys = Object.keys(value).toSorted();
  const expected = [
    'version',
    'generatedAt',
    'sourceFileCount',
    'sourceByteCount',
    'importedFileCount',
    'importedByteCount',
    'unresolvedUrls',
    'missingSourceRefs',
  ].toSorted();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return null;
  }
  if (
    evidence.version !== 1 ||
    typeof evidence.generatedAt !== 'string' ||
    Number.isNaN(Date.parse(evidence.generatedAt)) ||
    !nonnegativeInteger(evidence.sourceFileCount) ||
    !nonnegativeInteger(evidence.sourceByteCount) ||
    !nonnegativeInteger(evidence.importedFileCount) ||
    !nonnegativeInteger(evidence.importedByteCount) ||
    !Array.isArray(evidence.unresolvedUrls) ||
    evidence.unresolvedUrls.some((item) => typeof item !== 'string') ||
    !Array.isArray(evidence.missingSourceRefs) ||
    evidence.missingSourceRefs.some((item) => typeof item !== 'string')
  ) {
    return null;
  }
  return evidence as OpenMaicImportEvidenceV1;
}

export async function assertOpenMaicImportReady(
  evidencePath = OPENMAIC_IMPORT_EVIDENCE_PATH,
): Promise<void> {
  const serialized = await readFile(evidencePath, 'utf8');
  const evidence = parseOpenMaicImportEvidence(JSON.parse(serialized) as unknown);
  if (
    !evidence ||
    evidence.sourceFileCount !== evidence.importedFileCount ||
    evidence.sourceByteCount !== evidence.importedByteCount ||
    evidence.unresolvedUrls.length > 0 ||
    evidence.missingSourceRefs.length > 0
  ) {
    throw new Error('OpenMAIC legacy import evidence is incomplete');
  }
}
