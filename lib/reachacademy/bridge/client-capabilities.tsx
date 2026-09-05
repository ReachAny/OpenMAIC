'use client';

import { createContext, useContext } from 'react';

export interface OpenMaicClientGrantCapabilities {
  sub: string;
  actorOrgId: string;
  contentOrgId: string;
  courseId: string;
  stageId: string;
  stage: 'draft' | 'published';
  role: 'teacher' | 'student';
  expiresAt: number;
  roleOrigin: string;
  /**
   * Absolute URL of the host page this launch came from, guaranteed by the grant contract to be on
   * {@link roleOrigin}. Safe to hand to `location.assign` — OpenMAIC never builds host URLs itself.
   */
  returnTo: string;
  documentRead: boolean;
  documentWrite: boolean;
  agentRead: boolean;
  agentWrite: boolean;
  modelInvoke: boolean;
  modelInvokeLearner: boolean;
}

export interface OpenMaicClientCapabilities {
  databaseReady: boolean;
  grants: OpenMaicClientGrantCapabilities[];
}

const EMPTY_CAPABILITIES: OpenMaicClientCapabilities = { databaseReady: false, grants: [] };
const OpenMaicCapabilitiesContext = createContext(EMPTY_CAPABILITIES);

export function OpenMaicCapabilitiesProvider({
  value,
  children,
}: {
  value: OpenMaicClientCapabilities;
  children: React.ReactNode;
}) {
  if (typeof window !== 'undefined') {
    const active = value.grants.toSorted((a, b) => b.expiresAt - a.expiresAt)[0];
    if (active) {
      window.sessionStorage.setItem(
        'openmaic:launch-context',
        JSON.stringify({
          sub: active.sub,
          actorOrgId: active.actorOrgId,
          contentOrgId: active.contentOrgId,
          courseId: active.courseId,
          stageId: active.stageId,
          role: active.role,
          stage: active.stage,
          returnTo: active.returnTo,
          expiresAt: active.expiresAt,
        }),
      );
    }
  }
  return (
    <OpenMaicCapabilitiesContext.Provider value={value}>
      {children}
    </OpenMaicCapabilitiesContext.Provider>
  );
}

export function useOpenMaicCapabilities(
  stageId?: string | null,
): OpenMaicClientGrantCapabilities | null {
  const value = useContext(OpenMaicCapabilitiesContext);
  if (!value.databaseReady) return null;
  if (stageId) return value.grants.find((grant) => grant.stageId === stageId) ?? null;
  return value.grants.toSorted((a, b) => b.expiresAt - a.expiresAt)[0] ?? null;
}

export function useAnyOpenMaicDraftCapabilities(): OpenMaicClientGrantCapabilities | null {
  const value = useContext(OpenMaicCapabilitiesContext);
  if (!value.databaseReady) return null;
  return value.grants.find((grant) => grant.stage === 'draft') ?? null;
}
