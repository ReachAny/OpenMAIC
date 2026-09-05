'use client';

import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';

export function WorkspaceLoadingFallback() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background">
      <p role="status" className="text-sm text-muted-foreground">
        {t('workbench.common.loading')}
      </p>
    </main>
  );
}

/** Visible failure state for a workspace deep link without a valid stage grant. */
export function WorkspaceAccessDenied() {
  const { t } = useI18n();

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-6">
      <section
        role="alert"
        className="flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl border border-border/70 bg-card p-8 text-center shadow-lg"
      >
        <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground">
          {t('workbench.launch.openMaicDeniedTitle')}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('workbench.launch.openMaicDeniedDescription')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            {t('workbench.launch.openMaicRetry')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else window.location.assign('/');
            }}
          >
            {t('workbench.launch.openMaicBack')}
          </button>
        </div>
      </section>
    </main>
  );
}
