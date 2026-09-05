'use client';

import { useEffect, useState } from 'react';
import {
  useAnyOpenMaicDraftCapabilities,
  useOpenMaicCapabilities,
} from '@/lib/reachacademy/bridge/client-capabilities';
import { useOpenMaicHostReturnUrl } from '@/lib/reachacademy/use-openmaic-host-return';

/** OpenMAIC is only a ReachAcademy surface in this fork; anonymous/standalone use is denied. */
export function GrantRequiredGate({ children }: { readonly children: React.ReactNode }) {
  const draft = useAnyOpenMaicDraftCapabilities();
  const grant = useOpenMaicCapabilities();
  const returnTo = useOpenMaicHostReturnUrl();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (draft || grant || !returnTo || redirecting) return;
    setRedirecting(true);
    window.location.assign(returnTo);
  }, [draft, grant, redirecting, returnTo]);

  if (draft || grant) return <>{children}</>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <section
        role="alert"
        className="max-w-lg rounded-2xl border bg-card p-8 text-center shadow-lg"
      >
        <h1 className="text-xl font-semibold">OpenMAIC 授权已失效</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          当前页面缺少 ReachAcademy 教师授权上下文，课程内容不会继续展示。
        </p>
        {redirecting && <p className="mt-3 text-sm text-muted-foreground">正在返回教师端课程…</p>}
      </section>
    </main>
  );
}
