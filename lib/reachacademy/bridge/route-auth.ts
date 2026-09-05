import {
  authorizeOpenMaicRequest,
  openMaicAuthorizationResponse,
  type AuthorizedOpenMaicRequest,
} from './guard';

/** Run the authoritative bridge guard at the start of a classified API route. */
export async function requireOpenMaicRoute(
  request: Request,
  options: { stageId?: string; allowAnyStageGrant?: boolean } = {},
): Promise<{ authorization: AuthorizedOpenMaicRequest } | { response: Response }> {
  try {
    const authorization = await authorizeOpenMaicRequest(request, {
      stageId: options.stageId ?? request.headers.get('x-openmaic-stage-id'),
      allowAnyStageGrant: options.allowAnyStageGrant ?? true,
    });
    return { authorization };
  } catch (error) {
    return { response: openMaicAuthorizationResponse(error) };
  }
}
