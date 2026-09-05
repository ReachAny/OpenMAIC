import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import {
  createStorageHttpHandler,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  type AssetIndirectByteEgress,
} from '@openmaic/storage/server';

import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { resolveAssetCollectionGraceMs } from '@/lib/persistence/asset-collection-grace';
import {
  decideDocumentAccess,
  parseDocumentAction,
  type DocumentAccess,
} from '@/lib/persistence/document-access';
import { createOwnerBoundDocumentStore } from '@/lib/persistence/owner-bound-document-store';
import {
  getServerPersistenceProvider,
  type PersistencePoolFactory,
} from '@/lib/persistence/server-provider';
import { readStageMeta } from '@/lib/persistence/stage-meta';
import { APP_RUNTIME_PAYLOAD_VALIDATORS } from '@/lib/runtime/payload-validators';
import { stageConnectionString } from '@/lib/persistence/stage-routing';
import {
  authorizeOpenMaicRequest,
  markPrivateNoStore,
  openMaicAuthorizationResponse,
} from '@/lib/reachacademy/bridge/guard';
import type { OpenMaicRedisStore } from '@/lib/reachacademy/bridge/redis';
import type { OpenMaicStageGrantV1 } from '@/lib/reachacademy/bridge/contracts';

export const runtime = 'nodejs';

const ROUTE_PREFIX = '/api/persistence';

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * ASSET_BYTE_EGRESS: set to `redirect` to answer asset byte GETs with a 302 to
 * a short-lived signed URL, when the byte layer can sign (S3 can; the
 * PostgreSQL byte column cannot, and falls back to direct bytes). Anything
 * else, including unset and `direct`, keeps the default byte-for-byte
 * behavior. The tradeoff this opts into -- the redirect target names the
 * content hash -- is specified in the storage package's asset HTTP contract.
 */
function configuredAssetByteEgress(value: string | undefined): 'redirect' | undefined {
  const raw = value?.trim().toLowerCase();
  if (raw === 'redirect') return 'redirect';
  if (raw === undefined || raw === '' || raw === 'direct') return undefined;
  console.warn(`ASSET_BYTE_EGRESS=${value} is not recognized; using direct byte egress`);
  return undefined;
}

/**
 * Redirect egress and the collection grace must agree: a signed URL that
 * outlives its object turns a valid read into an object-store error. The
 * handler enforces that invariant itself, on the grace passed here, and this
 * grace is resolved by the collector's own parser so both components run on one
 * number.
 *
 * A grace too short for the default lifetime degrades to direct egress with a
 * loud warning rather than failing initialization: the asset backend is
 * optional, and its misconfiguration must never take document and runtime
 * traffic down with it.
 */
function indirectEgressWithinGrace(
  egress: 'redirect' | undefined,
): AssetIndirectByteEgress | undefined {
  if (egress !== 'redirect') return undefined;
  const collectionGraceMs = resolveAssetCollectionGraceMs();
  if (collectionGraceMs < DEFAULT_SIGNED_URL_TTL_SECONDS * 1000 * 10) {
    console.warn(
      `ASSET_BYTE_EGRESS=redirect requires ASSET_COLLECTION_GRACE_MS to be at least ten times ` +
        `the signed URL lifetime (${DEFAULT_SIGNED_URL_TTL_SECONDS}s); got ${collectionGraceMs}ms. ` +
        `Falling back to direct byte egress.`,
    );
    return undefined;
  }
  return { mode: 'redirect', collectionGraceMs };
}

async function createPersistenceHandler(
  connectionString: string,
  coursePrincipal: string,
  learnerKey: string,
  access: DocumentAccess,
  poolFactory?: PersistencePoolFactory,
): Promise<RequestListener> {
  const { pool, runtimeStore, assetStore } = await getServerPersistenceProvider(
    connectionString,
    poolFactory,
  );
  const documentStore = createOwnerBoundDocumentStore({
    pool,
    ownerId: coursePrincipal,
    validateScene: validateAppScene,
    validateStage: validateAppStage,
  });
  // Reclamation is not scheduled from here, and must not be: a route module
  // has no once-per-process guarantee and no shutdown hook. AssetCollector
  // runs from instrumentation.ts instead, over the byte store this same
  // lib/persistence/asset-byte-store selection produces, so the collector
  // always deletes through the layer the request path wrote through.
  const byteEgress = indirectEgressWithinGrace(
    configuredAssetByteEgress(process.env.ASSET_BYTE_EGRESS),
  );
  return createStorageHttpHandler(runtimeStore, documentStore, {
    authenticate: async () => ({ key: coursePrincipal, learnerKey }),
    authorizeMerge: async () => false,
    authorizeAdmin: async () => false,
    authorizeDocuments: async () => access === 'allow',
    validateScene: validateAppScene,
    validateStage: validateAppStage,
    payloadValidators: APP_RUNTIME_PAYLOAD_VALIDATORS,
    assetStore,
    ...(byteEgress === undefined ? {} : { byteEgress }),
  });
}

function routeRelativePath(request: Request): string {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith(ROUTE_PREFIX) ? pathname.slice(ROUTE_PREFIX.length) || '/' : pathname;
}

function nodeRequest(request: Request): IncomingMessage {
  const url = new URL(request.url);
  const pathname = url.pathname.startsWith(ROUTE_PREFIX)
    ? url.pathname.slice(ROUTE_PREFIX.length) || '/'
    : url.pathname;
  const body = request.body
    ? Readable.fromWeb(
        request.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
      )
    : Readable.from([]);
  const search = new URLSearchParams(url.search);
  search.delete('stage');
  return Object.assign(body, {
    method: request.method,
    url: `${pathname}${search.toString() === '' ? '' : `?${search.toString()}`}`,
    headers: Object.fromEntries(request.headers.entries()),
  }) as IncomingMessage;
}

function setHeaders(target: Headers, source: Record<string, string | number | string[]>): void {
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) target.append(name, item);
    } else {
      target.set(name, String(value));
    }
  }
}

type ResponseCallback = () => void;

function responseEncoding(encodingOrCallback?: BufferEncoding | ResponseCallback): BufferEncoding {
  const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8';
  if (!Buffer.isEncoding(encoding)) {
    // Let Buffer produce Node's ERR_UNKNOWN_ENCODING TypeError.
    Buffer.from('', encoding);
  }
  return encoding;
}

function responseCallback(
  encodingOrCallback?: BufferEncoding | ResponseCallback,
  callback?: ResponseCallback,
): ResponseCallback | undefined {
  return typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
}

function suppressesResponseBody(request: Request, status: number): boolean {
  return request.method === 'HEAD' || status === 204 || status === 205 || status === 304;
}

function isDocumentListRequest(request: Request): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  const pathname = new URL(request.url).pathname;
  const routePath = pathname.startsWith(ROUTE_PREFIX)
    ? pathname.slice(ROUTE_PREFIX.length)
    : pathname;
  return routePath === '/documents' || routePath === '/documents/';
}

async function bindRuntimeRequest(
  request: Request,
  path: string,
  grant: OpenMaicStageGrantV1,
): Promise<Request | null> {
  if (path !== '/runtime' && !path.startsWith('/runtime/')) return request;
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const stageIndex = parts.indexOf('stages') + 1;
  if (stageIndex > 0 && parts[stageIndex] !== grant.stageId) return null;
  const learnerIndex = parts.indexOf('learners') + 1;
  if (learnerIndex > 0) {
    if (!['GET', 'HEAD', 'DELETE'].includes(request.method)) return null;
    parts[learnerIndex] = grant.learnerKey;
  }
  const url = new URL(request.url);
  url.pathname = `${ROUTE_PREFIX}/${parts.map(encodeURIComponent).join('/')}`;

  if (request.method === 'POST' && path === '/runtime/sessions') {
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      return null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    return new Request(url, {
      method: request.method,
      headers,
      body: JSON.stringify({
        ...(body as Record<string, unknown>),
        stageId: grant.stageId,
        learnerKey: grant.learnerKey,
      }),
    });
  }
  if (url.toString() === request.url) return request;
  return new Request(url, { method: request.method, headers: request.headers });
}

function runNodeHandler(handler: RequestListener, request: Request): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let status = 200;
    const headers = new Headers();
    let headersSent = false;
    // Buffered as bytes rather than as a string. A handler may end with a
    // `Uint8Array`, which `ServerResponse.end` accepts and which is not
    // necessarily valid UTF-8; decoding it would replace every unpaired byte
    // with U+FFFD and silently corrupt the response.
    const body: Buffer[] = [];

    const appendChunk = (chunk: string | Uint8Array, encoding: BufferEncoding) => {
      body.push(typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk));
    };

    const response = {
      get headersSent() {
        return headersSent;
      },
      writeHead(
        statusCode: number,
        statusMessageOrHeaders?: string | Record<string, string | number | string[]>,
        outgoingHeaders?: Record<string, string | number | string[]>,
      ) {
        status = statusCode;
        headersSent = true;
        const values =
          typeof statusMessageOrHeaders === 'string' ? outgoingHeaders : statusMessageOrHeaders;
        if (values) setHeaders(headers, values);
        return this;
      },
      write(
        chunk: string | Uint8Array,
        encodingOrCallback?: BufferEncoding | ResponseCallback,
        callback?: ResponseCallback,
      ) {
        // `write` is part of the `ServerResponse` surface this object claims to
        // implement. Omitting it made any chunked handler a runtime TypeError
        // that the `as unknown as ServerResponse` cast hid from the compiler.
        headersSent = true;
        appendChunk(chunk, responseEncoding(encodingOrCallback));
        const done = responseCallback(encodingOrCallback, callback);
        if (done) process.nextTick(done);
        return true;
      },
      end(
        chunkOrCallback?: string | Uint8Array | ResponseCallback,
        encodingOrCallback?: BufferEncoding | ResponseCallback,
        callback?: ResponseCallback,
      ) {
        headersSent = true;
        const chunk = typeof chunkOrCallback === 'function' ? undefined : chunkOrCallback;
        const done =
          typeof chunkOrCallback === 'function'
            ? chunkOrCallback
            : responseCallback(encodingOrCallback, callback);
        if (chunk !== undefined) appendChunk(chunk, responseEncoding(encodingOrCallback));
        resolve(
          new Response(
            suppressesResponseBody(request, status) || body.length === 0
              ? undefined
              : Buffer.concat(body),
            {
              status,
              headers,
            },
          ),
        );
        if (done) process.nextTick(done);
        return this;
      },
      destroy(error?: Error) {
        reject(error ?? new Error('Persistence HTTP handler destroyed the response'));
        return this;
      },
    } as unknown as ServerResponse;

    try {
      handler(nodeRequest(request), response);
    } catch (error) {
      reject(error);
    }
  });
}

interface PersistenceRequestDeps {
  poolFactory?: PersistencePoolFactory;
  redis?: OpenMaicRedisStore;
  now?: number;
}

export async function handlePersistenceRequest(
  request: Request,
  deps: PersistenceRequestDeps = {},
): Promise<Response> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return jsonError(404, 'PERSISTENCE_NOT_CONFIGURED', 'server persistence not configured');
  }
  try {
    const authorization = await authorizeOpenMaicRequest(request, {
      store: deps.redis,
      now: deps.now,
    });
    const path = routeRelativePath(request);
    if (isDocumentListRequest(request)) {
      return jsonError(
        403,
        'PERSISTENCE_DOCUMENT_LIST_DISABLED',
        'document listing is disabled; address a document by stageId',
      );
    }
    const stageConnection = stageConnectionString(connectionString, authorization.grant.stage);
    const action = parseDocumentAction(request.method, path);
    if (
      action.kind !== 'unknown' &&
      action.kind !== 'list' &&
      action.stageId !== authorization.grant.stageId
    ) {
      return jsonError(403, 'OPENMAIC_STAGE_MISMATCH', 'request denied');
    }
    let access: DocumentAccess = 'allow';
    if (path === '/documents' || path.startsWith('/documents/')) {
      const { pool } = await getServerPersistenceProvider(stageConnection, deps.poolFactory);
      const queryable = pool;
      access = await decideDocumentAccess(
        action,
        authorization.grant.coursePrincipal,
        (stageId) => readStageMeta(queryable, stageId),
        (stageId) =>
          pool
            .query('SELECT 1 FROM document_stages WHERE id = $1', [stageId])
            .then((result) => result.rows.length > 0),
        (stageId) => readStageMeta(queryable, stageId),
      );
    }

    const boundRequest = await bindRuntimeRequest(request, path, authorization.grant);
    if (!boundRequest) return jsonError(403, 'OPENMAIC_STAGE_MISMATCH', 'request denied');
    if (path.startsWith('/runtime/sessions/')) {
      const sessionId = decodeURIComponent(path.split('/')[3] ?? '');
      const { runtimeStore } = await getServerPersistenceProvider(
        stageConnection,
        deps.poolFactory,
      );
      const runtimeSession = sessionId ? await runtimeStore.getSession(sessionId) : undefined;
      if (runtimeSession && runtimeSession.stageId !== authorization.grant.stageId) {
        return jsonError(404, 'RUNTIME_SESSION_NOT_FOUND', 'request denied');
      }
    }
    const response =
      access === 'not-found'
        ? jsonError(404, 'DOCUMENT_NOT_FOUND', '@openmaic/storage: document not found')
        : await runNodeHandler(
            await createPersistenceHandler(
              stageConnection,
              authorization.grant.coursePrincipal,
              authorization.grant.learnerKey,
              access,
              deps.poolFactory,
            ),
            boundRequest,
          );
    return path === '/assets' || path.startsWith('/assets/')
      ? markPrivateNoStore(response)
      : response;
  } catch (error) {
    const denied = openMaicAuthorizationResponse(error);
    if (denied.status !== 503) return denied;
    console.error('Embedded persistence route initialization failed', error);
    return jsonError(500, 'PERSISTENCE_INIT_FAILED', 'server persistence initialization failed');
  }
}

export const GET = (request: Request) => handlePersistenceRequest(request);
export const POST = (request: Request) => handlePersistenceRequest(request);
export const PUT = (request: Request) => handlePersistenceRequest(request);
export const PATCH = (request: Request) => handlePersistenceRequest(request);
export const DELETE = (request: Request) => handlePersistenceRequest(request);
