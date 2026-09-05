/**
 * `/workspace` — the Pro workspace home.
 *
 * Pro mode used to be a `useState` on `app/page.tsx`, which meant the global
 * `SiteHeader` could not know about it and stacked a second navigation bar on
 * top of the workspace's own sidebar. As a route it is addressable instead:
 * `AppChrome` suppresses the header by path prefix, a refresh keeps you here,
 * and the workspace can be linked to.
 *
 * The gate is server-side and requires a live database plus a verified draft
 * bridge grant with the authoring capabilities used by this surface. The
 * server-rendered capability bootstrap keeps the entry and destination in sync.
 *
 * `force-dynamic` keeps the grant request-scoped instead of baking it into a
 * prerender.
 *
 * The Suspense boundary covers the route seam that reads the initial deep-link
 * snapshot from `useSearchParams`. Once mounted, the workspace owns pane state
 * locally and mirrors it with the History API, so ordinary pane changes do not
 * ask the server route to render again.
 *
 */
import { Suspense } from 'react';
import { isWorkbenchEntryEnabled } from '@/lib/workbench/entry-gate';
import { WorkspaceEntry } from '@/components/workbench/WorkspaceEntry';
import { WorkspaceAccessDenied, WorkspaceLoadingFallback } from './access-denied';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams?: Promise<{ course?: string }>;
} = {}) {
  const courseId = (await searchParams)?.course;
  if (!(await isWorkbenchEntryEnabled(courseId))) return <WorkspaceAccessDenied />;

  return (
    <Suspense fallback={<WorkspaceLoadingFallback />}>
      <WorkspaceEntry />
    </Suspense>
  );
}
