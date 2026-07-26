import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  validateUrlForSSRF: vi.fn(),
  isServerConfiguredProvider: vi.fn(),
  resolveApiKey: vi.fn(),
  resolveBaseUrl: vi.fn(),
}));

vi.mock('@/lib/server/ssrf-guard', () => ({
  validateUrlForSSRF: mocks.validateUrlForSSRF,
}));

vi.mock('@/lib/server/provider-config', () => ({
  isServerConfiguredProvider: mocks.isServerConfiguredProvider,
  resolveApiKey: mocks.resolveApiKey,
  resolveBaseUrl: mocks.resolveBaseUrl,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

async function postProbeModels(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/provider/probe-models/route');
  const request = new Request('http://localhost/api/provider/probe-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

describe('POST /api/provider/probe-models', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.validateUrlForSSRF.mockReset();
    mocks.validateUrlForSSRF.mockResolvedValue(null);
    mocks.isServerConfiguredProvider.mockReset();
    mocks.isServerConfiguredProvider.mockReturnValue(false);
    mocks.resolveApiKey.mockReset();
    mocks.resolveBaseUrl.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps an upstream redirect to the exact redirect-not-allowed contract without reading it', async () => {
    const text = vi.fn().mockResolvedValue('redirect response body');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      text,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const res = await postProbeModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
    });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({
      success: false,
      errorCode: 'REDIRECT_NOT_ALLOWED',
      error: 'Redirects are not allowed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });

  it('preserves successful model filtering and response metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'chat-model', owned_by: 'provider' },
              { id: 'text-embedding-3-small', owned_by: 'provider' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const res = await postProbeModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      models: [{ id: 'chat-model', ownedBy: 'provider' }],
      total: 2,
      filtered: 1,
    });
  });

  it.each([401, 403])('preserves the API-key error contract for upstream %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: vi.fn().mockResolvedValue('invalid key'),
      } as unknown as Response),
    );

    const res = await postProbeModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'bad-key',
    });
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'API key is invalid or expired',
    });
  });

  it('preserves the manual-entry response when no model endpoint exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn(),
      } as unknown as Response),
    );

    const res = await postProbeModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'This provider does not expose a model list',
    });
  });

  describe('server-configured provider', () => {
    it('probes with the operator credentials and ignores the client pair', async () => {
      mocks.isServerConfiguredProvider.mockReturnValue(true);
      mocks.resolveBaseUrl.mockReturnValue('http://model-service:8100/v1');
      mocks.resolveApiKey.mockReturnValue('server-token');
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'chat-model', owned_by: 'litellm' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const res = await postProbeModels({
        providerId: 'openrouter',
        baseUrl: 'https://attacker.example.com',
        apiKey: 'client-key',
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.models).toEqual([{ id: 'chat-model', ownedBy: 'litellm' }]);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://model-service:8100/v1/models');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer server-token');
    });

    it('skips the SSRF guard so an in-cluster gateway stays reachable', async () => {
      mocks.isServerConfiguredProvider.mockReturnValue(true);
      mocks.resolveBaseUrl.mockReturnValue('http://model-service:8100/v1');
      mocks.resolveApiKey.mockReturnValue('server-token');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const res = await postProbeModels({ providerId: 'openrouter' });

      expect(res.status).toBe(200);
      expect(mocks.validateUrlForSSRF).not.toHaveBeenCalled();
    });

    it('still guards a client-supplied URL when the provider is not managed', async () => {
      mocks.isServerConfiguredProvider.mockReturnValue(false);
      mocks.validateUrlForSSRF.mockResolvedValue('Local network access is not allowed');

      const res = await postProbeModels({
        providerId: 'openrouter',
        baseUrl: 'http://169.254.169.254',
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.errorCode).toBe('INVALID_REQUEST');
      expect(mocks.validateUrlForSSRF).toHaveBeenCalledWith('http://169.254.169.254');
    });

    it('reports a managed provider that has no server-configured base URL', async () => {
      mocks.isServerConfiguredProvider.mockReturnValue(true);
      mocks.resolveBaseUrl.mockReturnValue(undefined);
      mocks.resolveApiKey.mockReturnValue('server-token');

      const res = await postProbeModels({ providerId: 'openrouter' });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('This provider has no server-configured base URL');
    });
  });
});
