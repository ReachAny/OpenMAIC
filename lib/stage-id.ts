import { nanoid } from 'nanoid';

/**
 * Stage ids reach the document store as a TEXT primary key and are interpolated
 * into `/classroom/:id` URLs, so an untrusted value is restricted to the same
 * shape a locally minted id has.
 */
export function isValidStageId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/**
 * Use the host-supplied stage id when one was passed in and is well formed,
 * otherwise mint a local one. An embedding host records the id before the deck
 * exists, so honouring it is what lets the host navigate back to this deck.
 */
export function resolveStageId(requestedStageId?: string): string {
  if (requestedStageId !== undefined && isValidStageId(requestedStageId)) {
    return requestedStageId;
  }
  return nanoid(10);
}
