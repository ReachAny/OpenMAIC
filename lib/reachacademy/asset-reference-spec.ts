import { createHash } from 'node:crypto';

import specJson from '../../openmaic-asset-reference-spec/v1.json';

export const ASSET_REFERENCE_SPEC_VERSION = 'openmaic-asset-reference-spec/v1' as const;
export const ASSET_REFERENCE_SLOT_KINDS = ['value', 'key-set'] as const;
export const ASSET_REFERENCE_REF_TYPES = [
  'asset-id',
  'legacy-classroom-media',
  'provider-url',
] as const;

export type AssetReferenceSlotKind = (typeof ASSET_REFERENCE_SLOT_KINDS)[number];
export type AssetReferenceRefType = (typeof ASSET_REFERENCE_REF_TYPES)[number];

interface DiscriminatorSpec {
  readonly path: readonly string[];
  readonly equals: string;
  readonly scope?: 'root';
}

interface ValueSlotSpec {
  readonly kind: 'value';
  readonly property: string;
}

interface SlideRoleSpec {
  readonly role: string;
  readonly containerPath: readonly string[];
  readonly discriminator: DiscriminatorSpec;
  readonly slot: ValueSlotSpec;
}

interface ContainerSpec {
  readonly role: string;
  readonly path: readonly string[];
  readonly discriminator?: DiscriminatorSpec;
  readonly childPath?: readonly string[];
  readonly kind: 'slide' | AssetReferenceSlotKind;
  readonly property?: string;
}

export interface AssetReferenceSpecV1 {
  readonly version: typeof ASSET_REFERENCE_SPEC_VERSION;
  readonly documentVersion: string;
  readonly slotKinds: readonly AssetReferenceSlotKind[];
  readonly refTypes: readonly AssetReferenceRefType[];
  readonly slideRoles: readonly SlideRoleSpec[];
  readonly containers: readonly ContainerSpec[];
}

export interface AssetReferenceOccurrence {
  readonly ref: string;
  readonly refType: AssetReferenceRefType;
  readonly slotKind: AssetReferenceSlotKind;
  readonly containerRole: string;
  readonly slotRole: string;
  readonly path: readonly (string | number)[];
}

export interface AssetReferenceClassificationOptions {
  readonly trustedOpenMaicOrigins?: readonly string[];
  readonly allowLegacyLocalhostImport?: boolean;
}

const ASSET_ID = /^ast_[0-9a-z]+$/;
const LEGACY_MEDIA_PATH = /^\/api\/classroom-media\/([^/]+)\/(media|audio)\/(.+)$/;
const CROCKFORD_LOWER = '0123456789abcdefghjkmnpqrstvwxyz';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function validateSpec(value: unknown): AssetReferenceSpecV1 {
  const candidate = record(value);
  if (
    !candidate ||
    candidate.version !== ASSET_REFERENCE_SPEC_VERSION ||
    typeof candidate.documentVersion !== 'string' ||
    !Array.isArray(candidate.slotKinds) ||
    !exactSet(candidate.slotKinds as string[], ASSET_REFERENCE_SLOT_KINDS) ||
    !Array.isArray(candidate.refTypes) ||
    !exactSet(candidate.refTypes as string[], ASSET_REFERENCE_REF_TYPES) ||
    !Array.isArray(candidate.slideRoles) ||
    !Array.isArray(candidate.containers)
  ) {
    throw new Error('OpenMAIC asset reference spec v1 is malformed or unsupported');
  }
  return candidate as unknown as AssetReferenceSpecV1;
}

export const OPENMAIC_ASSET_REFERENCE_SPEC = validateSpec(specJson);

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    const currentRecord = record(current);
    if (!currentRecord) return undefined;
    current = currentRecord[segment];
  }
  return current;
}

interface LocatedValue {
  readonly value: unknown;
  readonly path: readonly (string | number)[];
}

function locatePath(
  value: unknown,
  path: readonly string[],
  basePath: readonly (string | number)[] = [],
): LocatedValue[] {
  if (path.length === 0) return [{ value, path: basePath }];
  const [head, ...tail] = path;
  if (head === '*') {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value))
      throw new Error(`asset reference path ${basePath.join('.')} is not an array`);
    return value.flatMap((item, index) => locatePath(item, tail, [...basePath, index]));
  }
  const current = record(value);
  if (!current || !(head in current)) return [];
  return locatePath(current[head], tail, [...basePath, head]);
}

function discriminatorMatches(value: unknown, discriminator?: DiscriminatorSpec): boolean {
  return !discriminator || readPath(value, discriminator.path) === discriminator.equals;
}

export interface CanonicalLegacyClassroomMedia {
  readonly urlStageId: string;
  readonly relativePath: string;
}

export function canonicalizeLegacyClassroomMedia(
  ref: string,
  options: AssetReferenceClassificationOptions = {},
): CanonicalLegacyClassroomMedia | null {
  let path = ref;
  if (/^https?:\/\//i.test(ref)) {
    let url: URL;
    try {
      url = new URL(ref);
    } catch {
      return null;
    }
    const trusted = new Set(options.trustedOpenMaicOrigins ?? []);
    const importOnlyLocalhost =
      options.allowLegacyLocalhostImport === true && url.origin === 'http://localhost:3000';
    if (!trusted.has(url.origin) && !importOnlyLocalhost) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    path = url.pathname;
  }
  const match = path.match(LEGACY_MEDIA_PATH);
  if (!match) return null;
  let stageId: string;
  try {
    stageId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const relativePath = `${match[2]}/${match[3]}`;
  if (
    !stageId ||
    stageId.includes('/') ||
    relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return { urlStageId: stageId, relativePath };
}

export function classifyAssetReference(
  ref: string,
  options: AssetReferenceClassificationOptions = {},
): AssetReferenceRefType {
  if (ASSET_ID.test(ref)) return 'asset-id';
  if (canonicalizeLegacyClassroomMedia(ref, options)) return 'legacy-classroom-media';
  try {
    const url = new URL(ref);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash
    ) {
      return 'provider-url';
    }
  } catch {
    // Classified below as unsupported so publication/copy fail closed.
  }
  throw new Error(`unsupported OpenMAIC asset reference: ${ref}`);
}

function collectSlide(
  slide: unknown,
  container: LocatedValue,
  containerRole: string,
  options: AssetReferenceClassificationOptions,
): AssetReferenceOccurrence[] {
  const occurrences: AssetReferenceOccurrence[] = [];
  for (const role of OPENMAIC_ASSET_REFERENCE_SPEC.slideRoles) {
    for (const located of locatePath(slide, role.containerPath, container.path)) {
      if (
        !discriminatorMatches(
          role.discriminator.scope === 'root' ? slide : located.value,
          role.discriminator,
        )
      ) {
        continue;
      }
      const holder = record(located.value);
      if (!holder || !(role.slot.property in holder)) continue;
      const ref = holder[role.slot.property];
      if (ref === undefined || ref === null || ref === '') continue;
      if (typeof ref !== 'string') throw new Error(`asset slot ${role.role} is not a string`);
      occurrences.push({
        ref,
        refType: classifyAssetReference(ref, options),
        slotKind: 'value',
        containerRole,
        slotRole: role.role,
        path: [...located.path, role.slot.property],
      });
    }
  }
  return occurrences;
}

export function collectOpenMaicAssetReferences(
  document: unknown,
  options: AssetReferenceClassificationOptions = {},
): readonly AssetReferenceOccurrence[] {
  const root = record(document);
  if (!root || !record(root.stage) || !Array.isArray(root.scenes)) {
    throw new Error('OpenMAIC asset reference document must contain stage and scenes');
  }
  const occurrences: AssetReferenceOccurrence[] = [];
  for (const containerSpec of OPENMAIC_ASSET_REFERENCE_SPEC.containers) {
    for (const container of locatePath(root, containerSpec.path)) {
      if (!discriminatorMatches(container.value, containerSpec.discriminator)) continue;
      const selected = containerSpec.childPath
        ? locatePath(container.value, containerSpec.childPath, container.path)
        : [container];
      for (const located of selected) {
        if (containerSpec.kind === 'slide') {
          occurrences.push(...collectSlide(located.value, located, containerSpec.role, options));
          continue;
        }
        const holder = record(located.value);
        if (!holder) throw new Error(`asset container ${containerSpec.role} is not an object`);
        if (containerSpec.kind === 'key-set') {
          for (const ref of Object.keys(holder)) {
            occurrences.push({
              ref,
              refType: classifyAssetReference(ref, options),
              slotKind: 'key-set',
              containerRole: containerSpec.role,
              slotRole: containerSpec.role,
              path: [...located.path, ref],
            });
          }
          continue;
        }
        if (!containerSpec.property || !(containerSpec.property in holder)) continue;
        const ref = holder[containerSpec.property];
        if (ref === undefined || ref === null || ref === '') continue;
        if (typeof ref !== 'string')
          throw new Error(`asset slot ${containerSpec.role} is not a string`);
        occurrences.push({
          ref,
          refType: classifyAssetReference(ref, options),
          slotKind: 'value',
          containerRole: containerSpec.role,
          slotRole: containerSpec.role,
          path: [...located.path, containerSpec.property],
        });
      }
    }
  }
  return occurrences;
}

function encodeCrockfordLower(bytes: Uint8Array): string {
  let output = '';
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += CROCKFORD_LOWER[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) output += CROCKFORD_LOWER[(accumulator << (5 - bits)) & 31];
  return output;
}

function derivedId(domain: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update([domain, ...parts].join('\0'), 'utf8')
    .digest();
  return `ast_${encodeCrockfordLower(digest.subarray(0, 16))}`;
}

export function deterministicAssetReferenceId(input: {
  readonly refType: AssetReferenceRefType;
  readonly targetStageId: string;
  readonly sourceRef: string;
  readonly classification?: AssetReferenceClassificationOptions;
}): string {
  if (input.refType === 'asset-id') {
    return derivedId('openmaic-asset-v1', input.targetStageId, input.sourceRef);
  }
  if (input.refType === 'legacy-classroom-media') {
    const legacy = canonicalizeLegacyClassroomMedia(input.sourceRef, input.classification);
    if (!legacy) throw new Error('legacy classroom media reference is not canonicalizable');
    return derivedId(
      'openmaic-legacy-media-v1',
      input.targetStageId,
      legacy.urlStageId,
      legacy.relativePath,
    );
  }
  const url = new URL(input.sourceRef);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('provider asset reference must be HTTP(S)');
  }
  url.hash = '';
  return derivedId('openmaic-provider-url-v1', input.targetStageId, url.href);
}

function mutableParent(
  root: unknown,
  path: readonly (string | number)[],
): [Record<string, unknown>, string] {
  let current: unknown = root;
  for (const segment of path.slice(0, -1)) {
    current = Array.isArray(current)
      ? current[segment as number]
      : record(current)?.[segment as string];
  }
  const parent = record(current);
  const key = path.at(-1);
  if (!parent || typeof key !== 'string')
    throw new Error('asset reference rewrite path is invalid');
  return [parent, key];
}

/** Rewrite only declared slots; key-set references are renamed instead of mutating their values. */
export function rewriteOpenMaicAssetReferences<T>(
  document: T,
  replacements: ReadonlyMap<string, string>,
  options: AssetReferenceClassificationOptions = {},
): T {
  const clone = JSON.parse(JSON.stringify(document)) as T;
  const occurrences = collectOpenMaicAssetReferences(clone, options);
  for (const occurrence of occurrences) {
    const replacement = replacements.get(occurrence.ref);
    if (!replacement || replacement === occurrence.ref) continue;
    const [parent, key] = mutableParent(clone, occurrence.path);
    if (occurrence.slotKind === 'key-set') {
      if (replacement in parent && replacement !== key) {
        throw new Error(`asset key rewrite collision: ${replacement}`);
      }
      parent[replacement] = parent[key];
      delete parent[key];
    } else if (occurrence.containerRole === 'speech-audio-url') {
      if (typeof parent.audioId !== 'string' || !ASSET_ID.test(parent.audioId)) {
        parent.audioId = replacement;
      }
      delete parent.audioUrl;
    } else {
      parent[key] = replacement;
      if (occurrence.containerRole === 'speech-audio-id') delete parent.audioUrl;
    }
  }
  return clone;
}
