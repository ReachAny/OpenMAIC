export const runtime = 'nodejs';

/** ReachAcademy publication is owned exclusively by content-service. */
export async function POST(_request?: Request, _context?: { params: Promise<{ id: string }> }) {
  return new Response('Not found', { status: 404 });
}
