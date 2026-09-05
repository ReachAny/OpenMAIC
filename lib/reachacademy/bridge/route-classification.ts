import type { OpenMaicCapability, OpenMaicRole, OpenMaicStage } from './contracts';

export type OpenMaicPrincipalSurface = 'course' | 'personal' | 'learner' | 'none';

export type OpenMaicRouteClassification =
  | { auth: 'public' | 'launch-code' | 'renew-callback' | 'retired' }
  | {
      auth: 'session';
      capabilityAlternatives: readonly (readonly OpenMaicCapability[])[];
      principal: OpenMaicPrincipalSurface;
      roles?: readonly OpenMaicRole[];
      stages?: readonly OpenMaicStage[];
    };

const READ_METHODS = new Set(['GET', 'HEAD']);
const readOrWrite = (
  method: string,
  surface: 'document' | 'asset' | 'runtime' | 'agent' | 'material' | 'skill' | 'folder',
): OpenMaicCapability =>
  `${surface}.${READ_METHODS.has(method) ? 'read' : 'write'}` as OpenMaicCapability;

function session(
  capabilities: readonly OpenMaicCapability[],
  principal: OpenMaicPrincipalSurface,
  options: {
    roles?: readonly OpenMaicRole[];
    stages?: readonly OpenMaicStage[];
    alternatives?: readonly (readonly OpenMaicCapability[])[];
  } = {},
): OpenMaicRouteClassification {
  return {
    auth: 'session',
    capabilityAlternatives: options.alternatives ?? [capabilities],
    principal,
    ...(options.roles ? { roles: options.roles } : {}),
    ...(options.stages ? { stages: options.stages } : {}),
  };
}

export function classifyOpenMaicApiRoute(
  pathname: string,
  method: string,
): OpenMaicRouteClassification | null {
  const verb = method.toUpperCase();
  if (pathname === '/api/health' || pathname === '/api/ready') return { auth: 'public' };
  if (pathname === '/api/openmaic/exchange') return { auth: 'launch-code' };
  if (pathname === '/api/openmaic/renew/callback') return { auth: 'renew-callback' };
  if (pathname.startsWith('/api/access-code/')) return { auth: 'retired' };
  if (/^\/api\/stages\/[^/]+\/(?:publish|unpublish)$/.test(pathname)) return { auth: 'retired' };

  if (pathname === '/api/openmaic/renew/start') return session(['document.read'], 'course');
  // Minting a publish intent is not itself the publication — the Teacher app performs that with
  // the teacher's own credentials and re-authorizes first. But it is the act that starts one, so
  // it is held to the same shape as the write it leads to: a teacher, on the draft, who may write
  // the document they are about to ship.
  if (pathname === '/api/openmaic/publish/start') {
    return session(['document.write'], 'course', { roles: ['teacher'], stages: ['draft'] });
  }
  if (pathname === '/api/persistence' || pathname.startsWith('/api/persistence/')) {
    const relative = pathname.slice('/api/persistence'.length);
    if (relative === '/assets' || relative.startsWith('/assets/')) {
      return session([readOrWrite(verb, 'asset')], 'course');
    }
    if (relative === '/runtime' || relative.startsWith('/runtime/')) {
      if (
        (relative === '/runtime' && !READ_METHODS.has(verb)) ||
        relative === '/runtime/learners/merge'
      ) {
        return null;
      }
      return session([readOrWrite(verb, 'runtime')], 'learner');
    }
    if (relative === '/documents' || relative.startsWith('/documents/')) {
      return session([readOrWrite(verb, 'document')], 'course');
    }
    return null;
  }
  if (
    pathname === '/api/stages' ||
    pathname.startsWith('/api/stages/') ||
    pathname.startsWith('/api/stage-meta/')
  ) {
    return session([readOrWrite(verb, 'document')], 'course');
  }
  if (pathname === '/api/classroom') return session([readOrWrite(verb, 'document')], 'course');
  if (pathname.startsWith('/api/classroom-media/')) return session(['asset.read'], 'course');

  if (pathname === '/api/agent' || pathname.startsWith('/api/agent/')) {
    const capabilities: OpenMaicCapability[] = [readOrWrite(verb, 'agent')];
    if (pathname === '/api/agent/skills' || pathname.startsWith('/api/agent/skills/')) {
      capabilities.push(readOrWrite(verb, 'skill'));
    }
    return session(capabilities, 'personal');
  }
  if (pathname === '/api/materials' || pathname.startsWith('/api/materials/')) {
    return session([readOrWrite(verb, 'material')], 'personal');
  }
  if (pathname === '/api/skills' || pathname.startsWith('/api/skills/')) {
    return session([readOrWrite(verb, 'skill')], 'personal');
  }
  if (pathname === '/api/folders' || pathname.startsWith('/api/folders/')) {
    return session([readOrWrite(verb, 'folder')], 'course');
  }

  const learnerModelRoute =
    pathname === '/api/quiz-grade' ||
    pathname === '/api/chat' ||
    pathname === '/api/chat/pi' ||
    pathname === '/api/chat/pi/whiteboard-visibility' ||
    pathname === '/api/generate/tts' ||
    pathname.startsWith('/api/pbl/v2/');
  if (learnerModelRoute) {
    return session([], 'learner', {
      alternatives: [['model.invoke'], ['model.invoke.learner']],
    });
  }

  if (pathname === '/api/export-video/capability') {
    return session(['model.invoke'], 'course', { roles: ['teacher'], stages: ['draft'] });
  }
  if (pathname.startsWith('/api/export-video/')) {
    return session(['export.read', 'export.write', 'model.invoke'], 'course', {
      roles: ['teacher'],
      stages: ['draft'],
    });
  }

  const authoringModelRoute =
    pathname === '/api/generate-classroom' ||
    pathname.startsWith('/api/generate-classroom/') ||
    pathname.startsWith('/api/generate/') ||
    pathname === '/api/parse-pdf' ||
    pathname === '/api/web-search' ||
    pathname === '/api/transcription' ||
    pathname === '/api/extract-document' ||
    pathname === '/api/proxy-media';
  if (authoringModelRoute) {
    return session(['model.invoke'], 'course', { roles: ['teacher'], stages: ['draft'] });
  }

  if (
    [
      '/api/verify-model',
      '/api/verify-image-provider',
      '/api/verify-pdf-provider',
      '/api/verify-video-provider',
      '/api/azure-voices',
      '/api/comfyui-workflows',
      '/api/server-providers',
      '/api/provider/probe-models',
      '/api/usage',
    ].includes(pathname)
  ) {
    return session(['model.invoke'], 'course', { roles: ['teacher'], stages: ['draft'] });
  }
  return null;
}
