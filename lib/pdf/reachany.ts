import type { PDFParserConfig } from './types';
import type { ParsedPdfContent } from '@/lib/types/pdf';

interface ReachAnyImage {
  id: string;
  page_number: number;
  mime_type: string;
  data: string;
  description?: string;
  width?: number;
  height?: number;
}

interface ReachAnyExtractionResponse {
  text: string;
  images?: ReachAnyImage[];
  metadata?: {
    page_count?: number;
    [key: string]: unknown;
  };
}

function buildExtractionUrl(baseUrl?: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('ReachAny document gateway base URL is required');
  if (base.endsWith('/v1/document/extractions')) return base;
  if (base.endsWith('/v1')) return `${base}/document/extractions`;
  return `${base}/v1/document/extractions`;
}

/** Calls model-service's provider-neutral document extraction contract. */
export async function parseWithReachAny(
  config: PDFParserConfig,
  documentBuffer: Buffer,
  options?: { fileName?: string; mimeType?: string },
): Promise<ParsedPdfContent> {
  if (!config.apiKey) throw new Error('ReachAny document gateway API key is required');

  const bytes = documentBuffer.buffer.slice(
    documentBuffer.byteOffset,
    documentBuffer.byteOffset + documentBuffer.byteLength,
  ) as ArrayBuffer;
  const form = new FormData();
  form.append(
    'file',
    new Blob([bytes], { type: options?.mimeType || 'application/pdf' }),
    options?.fileName || 'document.pdf',
  );

  const response = await fetch(buildExtractionUrl(config.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || `ReachAny document extraction failed (${response.status})`);
  }

  const data = (await response.json()) as ReachAnyExtractionResponse;
  if (typeof data.text !== 'string') {
    throw new Error('ReachAny document extraction returned an invalid response');
  }
  const pdfImages = (data.images || []).map((image) => ({
    id: image.id,
    src: `data:${image.mime_type};base64,${image.data}`,
    pageNumber: image.page_number,
    description: image.description,
    width: image.width,
    height: image.height,
  }));

  return {
    text: data.text,
    images: pdfImages.map((image) => image.src),
    metadata: {
      ...data.metadata,
      pageCount: data.metadata?.page_count ?? 0,
      parser: 'reachany',
      pdfImages,
    },
  };
}
