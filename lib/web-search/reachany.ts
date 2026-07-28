import type { WebSearchResult, WebSearchSource } from '@/lib/types/web-search';

interface ReachAnySearchResponse {
  query: string;
  answer?: string;
  response_time?: number;
  sources?: Array<{
    title: string;
    url: string;
    content?: string;
    score?: number;
  }>;
}

function buildSearchUrl(baseUrl?: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('ReachAny web search gateway base URL is required');
  if (base.endsWith('/v1/web/search')) return base;
  if (base.endsWith('/v1')) return `${base}/web/search`;
  return `${base}/v1/web/search`;
}

/** Calls model-service's provider-neutral web search contract. */
export async function searchWithReachAny(params: {
  query: string;
  apiKey: string;
  maxResults?: number;
  baseUrl?: string;
}): Promise<WebSearchResult> {
  const { query, apiKey, maxResults = 5, baseUrl } = params;
  if (!apiKey) throw new Error('ReachAny web search gateway API key is required');

  const startedAt = Date.now();
  const response = await fetch(buildSearchUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, max_results: maxResults }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || `ReachAny web search failed (${response.status})`);
  }

  const data = (await response.json()) as ReachAnySearchResponse;
  const sources: WebSearchSource[] = (data.sources || [])
    .filter((source) => source.url)
    .map((source) => ({
      title: source.title || source.url,
      url: source.url,
      content: source.content || '',
      score: source.score ?? 0,
    }));
  return {
    answer: data.answer || '',
    sources,
    query: data.query || query,
    responseTime: data.response_time ?? (Date.now() - startedAt) / 1000,
  };
}
