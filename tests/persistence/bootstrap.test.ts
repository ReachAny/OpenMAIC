import { beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  } as Storage;
}

describe('persistence client bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('leaves all sealed storage seams untouched when the flag is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_PERSISTENCE', '');

    const runtime = await import('@/lib/runtime/store');
    const documents = await import('@/lib/document-store');
    const assets = await import('@/lib/media/asset-pool-config');

    expect(runtime.isRuntimeStorageConfigured()).toBe(false);
    expect(documents.isDocumentStorageConfigured()).toBe(false);
    expect(assets.isAssetPoolStorageConfigured()).toBe(false);
  });

  it('configures runtime and document HTTP stores without wiring the asset pool', async () => {
    vi.stubEnv('NEXT_PUBLIC_PERSISTENCE', '1');
    vi.stubGlobal('window', {
      location: { pathname: '/classroom/stage-1', search: '' },
    });
    vi.stubGlobal('localStorage', memoryStorage());

    const { HttpDocumentStore } = await import('@openmaic/storage');
    const { HttpRuntimeStore } = await import('@openmaic/storage/runtime/http');
    // Importing either seam must structurally run bootstrap before the seam can
    // resolve its default store.
    const runtime = await import('@/lib/runtime/store');
    const documents = await import('@/lib/document-store');
    const assets = await import('@/lib/media/asset-pool-config');

    expect(runtime.isRuntimeStorageConfigured()).toBe(true);
    expect(documents.isDocumentStorageConfigured()).toBe(true);
    expect(assets.isAssetPoolStorageConfigured()).toBe(false);

    const runtimeStore = runtime.getRuntimeStore();
    const documentStore = documents.getDocumentStore();
    expect(runtimeStore).toBeInstanceOf(HttpRuntimeStore);
    expect(documentStore).toBeInstanceOf(HttpDocumentStore);

    const documentInternals = documentStore as unknown as {
      validateSceneFn: unknown;
      validateStageFn: unknown;
    };
    expect(documentInternals.validateSceneFn).toBe(documents.validateAppScene);
    expect(documentInternals.validateStageFn).toBe(documents.validateAppStage);

    const runtimeHeaders = await (
      runtimeStore as unknown as {
        headersHook: (context: { method: string; path: string }) => Promise<HeadersInit>;
      }
    ).headersHook({ method: 'GET', path: '/runtime/sessions/example' });
    expect(new Headers(runtimeHeaders)).toEqual(new Headers({ 'x-openmaic-stage-id': 'stage-1' }));
    expect(new Headers(runtimeHeaders).has('authorization')).toBe(false);
    expect(new Headers(runtimeHeaders).has('x-learner-key')).toBe(false);

    runtime.resetRuntimeStorageForTests();
    documents.resetDocumentStorageForTests();
    expect(runtime.isRuntimeStorageConfigured()).toBe(false);
    expect(documents.isDocumentStorageConfigured()).toBe(false);
    expect(assets.isAssetPoolStorageConfigured()).toBe(false);
  });

  it('binds Pro workbench persistence to the active course stage', async () => {
    vi.stubEnv('NEXT_PUBLIC_PERSISTENCE', '1');
    vi.stubGlobal('window', {
      location: { pathname: '/workspace', search: '?course=stage-pro-1' },
    });
    vi.stubGlobal('localStorage', memoryStorage());

    const runtime = await import('@/lib/runtime/store');
    const documents = await import('@/lib/document-store');
    const runtimeStore = runtime.getRuntimeStore() as unknown as {
      headersHook: (context: { method: string; path: string }) => Promise<HeadersInit>;
    };
    const documentStore = documents.getDocumentStore() as unknown as {
      headersHook: (context: { method: string; path: string }) => Promise<HeadersInit>;
    };

    await expect(
      runtimeStore.headersHook({ method: 'POST', path: '/runtime/stages/stage-pro-1/sessions' }),
    ).resolves.toEqual({ 'x-openmaic-stage-id': 'stage-pro-1' });
    await expect(
      documentStore.headersHook({ method: 'PUT', path: '/documents/stage-pro-1' }),
    ).resolves.toEqual({ 'x-openmaic-stage-id': 'stage-pro-1' });
  });

  it('binds the generation entry and its preview to the host-pinned stage', async () => {
    vi.stubEnv('NEXT_PUBLIC_PERSISTENCE', '1');
    vi.stubGlobal('window', {
      location: { pathname: '/generation-preview', search: '?stageId=stage-gen-1' },
    });
    vi.stubGlobal('localStorage', memoryStorage());

    const documents = await import('@/lib/document-store');
    const documentStore = documents.getDocumentStore() as unknown as {
      headersHook: (context: { method: string; path: string }) => Promise<HeadersInit>;
    };

    // The generation flow ends with a document write while still on
    // `/generation-preview`. Without the stage id in that URL the write fails
    // closed with OPENMAIC_STAGE_REQUIRED and the generated deck never reaches
    // `openmaic_draft`, so the module has nothing to publish.
    await expect(
      documentStore.headersHook({ method: 'PUT', path: '/documents/stage-gen-1' }),
    ).resolves.toEqual({ 'x-openmaic-stage-id': 'stage-gen-1' });
  });

  it('does not run client configuration during server module evaluation', async () => {
    vi.stubEnv('NEXT_PUBLIC_PERSISTENCE', '1');

    const runtime = await import('@/lib/runtime/store');
    const documents = await import('@/lib/document-store');
    const assets = await import('@/lib/media/asset-pool-config');

    expect(runtime.isRuntimeStorageConfigured()).toBe(false);
    expect(documents.isDocumentStorageConfigured()).toBe(false);
    expect(assets.isAssetPoolStorageConfigured()).toBe(false);
  });

  it('preflights both configured seams so a failure cannot partially configure bootstrap', async () => {
    vi.stubEnv('NEXT_PUBLIC_PERSISTENCE', '1');
    vi.stubGlobal('window', {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const documents = await import('@/lib/document-store/config');
    documents.configureDocumentStorage({});

    const runtime = await import('@/lib/runtime/store');
    const assets = await import('@/lib/media/asset-pool-config');

    expect(runtime.isRuntimeStorageConfigured()).toBe(false);
    expect(documents.isDocumentStorageConfigured()).toBe(true);
    expect(assets.isAssetPoolStorageConfigured()).toBe(false);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toContain('FATAL');
  });
});
