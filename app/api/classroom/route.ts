import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { buildRequestOrigin, isValidClassroomId } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { requireOpenMaicRoute } from '@/lib/reachacademy/bridge/route-auth';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';

const log = createLogger('Classroom API');

export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const auth = await requireOpenMaicRoute(request, { stageId: id, allowAnyStageGrant: false });
    if ('response' in auth) return auth.response;
    const baseUrl = buildRequestOrigin(request);

    const ownerStore = await getOwnerScopedDocumentStore(auth.authorization.principal);
    const persistedStage = { ...stage, id };
    await ownerStore.saveDocument({ stage: persistedStage, scenes });

    return apiSuccess({ id, url: `${baseUrl}/classroom/${id}` }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const auth = await requireOpenMaicRoute(request, { stageId: id, allowAnyStageGrant: false });
    if ('response' in auth) return auth.response;
    const ownerStore = await getOwnerScopedDocumentStore(auth.authorization.principal);
    const document = await ownerStore.loadDocument(id);
    const classroom = document
      ? { id, stage: document.stage, scenes: document.scenes, createdAt: new Date().toISOString() }
      : null;
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    return apiSuccess({ classroom });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
