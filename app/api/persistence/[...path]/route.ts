import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { PgDocumentStore, ensureDocumentSchema } from '@openmaic/storage/document/pg';
import { PgRuntimeStore, ensureSchema } from '@openmaic/storage/runtime/pg';
import { createStorageHttpHandler } from '@openmaic/storage/server';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { Pool } from 'pg';

import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { authenticatePersistenceRequest } from '@/lib/persistence/server-auth';

export const runtime = 'nodejs';

const ROUTE_PREFIX = '/api/persistence';

/**
 * Stages are addressed per request rather than per process so one deployment can serve both the
 * authoring copy and the published copy.
 *
 * `published` is served read-only: a single process can reach both schemas, so the separation that
 * used to come from two differently-credentialed processes is enforced here instead. Without this
 * the authoring UI could rewrite already-published courseware.
 */
const STAGE_SCHEMAS = {
  draft: { schema: 'openmaic_draft', readOnly: false },
  published: { schema: 'openmaic_published', readOnly: true },
} as const;

type StageName = keyof typeof STAGE_SCHEMAS;

const DEFAULT_STAGE: StageName = 'draft';
const STAGE_HEADER = 'x-openmaic-stage';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isStageName(value: string): value is StageName {
  return Object.hasOwn(STAGE_SCHEMAS, value);
}

/**
 * Pin the schema on the connection string rather than via PGOPTIONS.
 *
 * The document DDL and queries use unqualified table names, so which copy they resolve to is a
 * property of the connection. Carrying it here means every connection the pool opens — including
 * ones created later to replace a dropped one — lands on the same schema, and which copy a request
 * reaches stops depending on how the process was launched.
 */
function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

/** Resolve which copy a request addresses, defaulting to the authoring one. */
function resolveStage(request: Request): StageName | undefined {
  const requested =
    new URL(request.url).searchParams.get('stage') ?? request.headers.get(STAGE_HEADER);
  if (requested === null || requested === '') return DEFAULT_STAGE;
  return isStageName(requested) ? requested : undefined;
}

type PoolFactory = (connectionString: string) => Pool;

interface PersistenceHandlerState {
  connectionString?: string;
  handlerPromise?: Promise<RequestListener>;
}

const HANDLER_STATE_KEY = Symbol.for('openmaic.persistence-route.handler');
const globalState = globalThis as typeof globalThis & {
  [key: symbol]: Map<StageName, PersistenceHandlerState> | undefined;
};
const handlerStates = (globalState[HANDLER_STATE_KEY] ??= new Map<
  StageName,
  PersistenceHandlerState
>());

function handlerStateFor(stage: StageName): PersistenceHandlerState {
  let state = handlerStates.get(stage);
  if (state === undefined) {
    state = {};
    handlerStates.set(stage, state);
  }
  return state;
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function isDocumentListRequest(request: Request): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  const pathname = new URL(request.url).pathname;
  const routePath = pathname.startsWith(ROUTE_PREFIX)
    ? pathname.slice(ROUTE_PREFIX.length)
    : pathname;
  return routePath === '/documents' || routePath === '/documents/';
}

async function createPersistenceHandler(
  connectionString: string,
  poolFactory: PoolFactory,
  stage: StageName,
): Promise<RequestListener> {
  const { schema } = STAGE_SCHEMAS[stage];
  const pool = poolFactory(withSearchPath(connectionString, schema));
  const queryable = pool as unknown as ConnectableQueryable;
  try {
    await queryable.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await ensureSchema(queryable);
    await ensureDocumentSchema(queryable);
    const withTransaction = nodePostgresTransaction(queryable);
    const runtimeStore = new PgRuntimeStore(queryable, { withTransaction });
    const documentStore = new PgDocumentStore(queryable, {
      withTransaction,
      validateScene: validateAppScene,
      validateStage: validateAppStage,
    });
    return createStorageHttpHandler(runtimeStore, documentStore, {
      authenticate: authenticatePersistenceRequest,
      authorizeMerge: async () => false,
      authorizeAdmin: async () => false,
      authorizeDocuments: async () => true,
      validateScene: validateAppScene,
      validateStage: validateAppStage,
    });
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}

function getPersistenceHandler(
  connectionString: string,
  poolFactory: PoolFactory,
  stage: StageName,
): Promise<RequestListener> {
  const handlerState = handlerStateFor(stage);
  if (handlerState.handlerPromise && handlerState.connectionString === connectionString) {
    return handlerState.handlerPromise;
  }

  handlerState.connectionString = connectionString;
  const initialization = createPersistenceHandler(connectionString, poolFactory, stage).catch(
    (error) => {
      // Do not poison the singleton with a rejected promise. createPersistenceHandler
      // has already closed its failed pool, and the next request gets a clean retry.
      if (handlerState.handlerPromise === initialization) {
        handlerState.handlerPromise = undefined;
        handlerState.connectionString = undefined;
      }
      throw error;
    },
  );
  handlerState.handlerPromise = initialization;
  return initialization;
}

function nodeRequest(request: Request): IncomingMessage {
  const url = new URL(request.url);
  const pathname = url.pathname.startsWith(ROUTE_PREFIX)
    ? url.pathname.slice(ROUTE_PREFIX.length) || '/'
    : url.pathname;
  // The stage selector is consumed here; the storage handler must not see it as a query filter.
  const search = new URLSearchParams(url.search);
  search.delete('stage');
  const query = search.toString();
  const body = request.body
    ? Readable.fromWeb(
        request.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
      )
    : Readable.from([]);
  return Object.assign(body, {
    method: request.method,
    url: `${pathname}${query === '' ? '' : `?${query}`}`,
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

function runNodeHandler(handler: RequestListener, request: Request): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let status = 200;
    const headers = new Headers();
    let headersSent = false;

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
      end(chunk?: string | Uint8Array) {
        headersSent = true;
        resolve(
          new Response(
            chunk === undefined
              ? undefined
              : typeof chunk === 'string'
                ? chunk
                : Buffer.from(chunk).toString(),
            {
              status,
              headers,
            },
          ),
        );
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
  poolFactory?: PoolFactory;
}

export async function handlePersistenceRequest(
  request: Request,
  deps: PersistenceRequestDeps = {},
): Promise<Response> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return jsonError(404, 'PERSISTENCE_NOT_CONFIGURED', 'server persistence not configured');
  }
  if (!process.env.PERSISTENCE_DEV_TOKEN) {
    return jsonError(
      503,
      'PERSISTENCE_DEV_TOKEN_MISSING',
      'server persistence requires PERSISTENCE_DEV_TOKEN (development auth only)',
    );
  }

  const stage = resolveStage(request);
  if (stage === undefined) {
    return jsonError(400, 'PERSISTENCE_STAGE_UNKNOWN', 'unknown persistence stage');
  }
  if (isDocumentListRequest(request)) {
    return jsonError(
      403,
      'PERSISTENCE_DOCUMENT_LIST_DISABLED',
      'document listing is disabled; address a document by stageId',
    );
  }
  if (STAGE_SCHEMAS[stage].readOnly && MUTATING_METHODS.has(request.method.toUpperCase())) {
    return jsonError(
      403,
      'PERSISTENCE_STAGE_READ_ONLY',
      `persistence stage "${stage}" is read-only`,
    );
  }

  try {
    const poolFactory = deps.poolFactory ?? ((value) => new Pool({ connectionString: value }));
    return await runNodeHandler(
      await getPersistenceHandler(connectionString, poolFactory, stage),
      request,
    );
  } catch (error) {
    console.error('Embedded persistence route initialization failed', error);
    return jsonError(500, 'PERSISTENCE_INIT_FAILED', 'server persistence initialization failed');
  }
}

export const GET = (request: Request) => handlePersistenceRequest(request);
export const POST = (request: Request) => handlePersistenceRequest(request);
export const PUT = (request: Request) => handlePersistenceRequest(request);
export const PATCH = (request: Request) => handlePersistenceRequest(request);
export const DELETE = (request: Request) => handlePersistenceRequest(request);
