'use client';

import { CheckCircle2, Loader2, Send, TriangleAlert } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useOpenMaicCapabilities } from '@/lib/reachacademy/bridge/client-capabilities';
import { useOpenMaicPublish } from '@/lib/reachacademy/use-openmaic-publish';
import { useStageStore } from '@/lib/store/stage';
import { cn } from '@/lib/utils';

/**
 * Publish the open course back to ReachAcademy, from inside the editor.
 *
 * Renders nothing at all outside a ReachAcademy draft launch: a standalone OpenMAIC deployment has
 * no bridge grant, and a learner or a read-only preview holds one without `document.write`. The
 * button is therefore self-gating and safe to mount unconditionally in shared chrome.
 */
export function OpenMaicPublishButton({
  variant = 'default',
}: {
  variant?: 'default' | 'compact';
}) {
  const { t } = useI18n();
  const stageId = useStageStore((state) => state.stage?.id ?? null);
  const grant = useOpenMaicCapabilities(stageId);
  const publishable = grant?.stage === 'draft' && grant.documentWrite;
  // Hook order is fixed; the grant decides what renders, not whether hooks run.
  const { publish, result, state } = useOpenMaicPublish(stageId, grant?.roleOrigin ?? null);

  if (!publishable) return null;

  const label =
    state === 'running'
      ? t('workbench.publish.running')
      : state === 'error'
        ? t('workbench.publish.failed')
        : state === 'done'
          ? result?.published
            ? t('workbench.publish.done', { version: String(result.versionNo) })
            : t('workbench.publish.unchanged')
          : t('workbench.publish.action');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            'shrink-0 inline-flex items-center gap-1.5 rounded-full border font-bold transition-colors',
            'border-violet-500/60 bg-violet-600 text-white shadow-sm hover:bg-violet-500',
            'disabled:cursor-not-allowed disabled:opacity-60',
            variant === 'compact' ? 'h-8 px-3 text-[11px]' : 'h-9 px-3.5 text-xs',
          )}
          disabled={state === 'running'}
          onClick={publish}
          type="button"
        >
          {state === 'running' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : state === 'error' ? (
            <TriangleAlert className="size-3.5" />
          ) : state === 'done' ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <Send className="size-3.5" />
          )}
          <span>{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{t('workbench.publish.hint')}</TooltipContent>
    </Tooltip>
  );
}
