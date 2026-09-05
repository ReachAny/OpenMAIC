import { NextRequest, NextResponse } from 'next/server';

import {
  authorizeOpenMaicRequest,
  openMaicAuthorizationResponse,
} from '@/lib/reachacademy/bridge/guard';

/** Legacy media is served only after import into the asset pool. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classroomId: string; path: string[] }> },
): Promise<Response> {
  const { classroomId } = await params;
  try {
    await authorizeOpenMaicRequest(req, { stageId: classroomId });
  } catch (error) {
    return openMaicAuthorizationResponse(error);
  }
  return NextResponse.json(
    { error: 'Legacy classroom media is unavailable' },
    { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
