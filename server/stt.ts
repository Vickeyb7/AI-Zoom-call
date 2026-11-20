/**
 * Deepgram Speech-to-Text Adapter (implementation_v0.5 §2.1 & §13)
 *
 * - Exclusive speech-to-text provider for live audio transcription.
 * - Requires DEEPGRAM_API_KEY.
 * - Uses Deepgram Nova-3 pre-recorded REST endpoint for low-latency audio chunk transcription.
 */

import { logger } from './logger.ts';

export interface SttConfig {
  provider: 'deepgram';
  model: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
}

export class MissingDeepgramKeyError extends Error {
  readonly code = 'MISSING_DEEPGRAM_API_KEY';
  constructor() {
    super(
      'Missing required environment variable DEEPGRAM_API_KEY. Configure DEEPGRAM_API_KEY in .env or environment secrets to enable Deepgram speech-to-text.',
    );
    this.name = 'MissingDeepgramKeyError';
  }
}

export function getSttConfig(): SttConfig {
  const model = (process.env.DEEPGRAM_MODEL?.trim() || 'nova-3').replace(/\s+/g, '');
  const baseUrl = (process.env.DEEPGRAM_BASE_URL?.trim() || 'https://api.deepgram.com/v1').replace(
    /\/+$/,
    '',
  );
  return {
    provider: 'deepgram',
    model,
    baseUrl,
    apiKeyConfigured: Boolean(process.env.DEEPGRAM_API_KEY?.trim()),
  };
}

function isSilentPcmWav(buffer: Buffer, cleanMime: string): boolean {
  if (cleanMime !== 'audio/wav' || buffer.length <= 44) return false;
  let maxAbs = 0;
  for (let i = 44; i + 1 < buffer.length; i += 2) {
    const sample = Math.abs(buffer.readInt16LE(i));
    if (sample > maxAbs) maxAbs = sample;
    if (maxAbs > 180) return false;
  }
  return maxAbs <= 180;
}

export async function transcribeWithDeepgram(params: {
  buffer: Buffer;
  mimeType: string;
  timeoutMs?: number;
}): Promise<string> {
  const cleanMime = params.mimeType.split(';')[0].trim() || 'audio/webm';
  if (isSilentPcmWav(params.buffer, cleanMime)) {
    return '';
  }

  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingDeepgramKeyError();
  }

  const cfg = getSttConfig();
  const timeoutMs = params.timeoutMs ?? 20000;
  const query = new URLSearchParams({
    model: cfg.model,
    smart_format: 'true',
    punctuate: 'true',
    language: 'en',
  });
  const url = `${cfg.baseUrl}/listen?${query.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': cleanMime,
      },
      body: new Uint8Array(params.buffer),
      signal: controller.signal,
    });

    const requestId = res.headers.get('dg-request-id') || 'n/a';
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Deepgram HTTP ${res.status}: ${bodyText.slice(0, 220)}`);
    }

    const parsed = JSON.parse(bodyText) as {
      results?: {
        channels?: {
          alternatives?: { transcript?: string; confidence?: number }[];
        }[];
      };
    };

    const alt = parsed.results?.channels?.[0]?.alternatives?.[0];
    const transcript = (alt?.transcript || '').trim();
    const confidence = alt?.confidence ?? 0;

    logger.info(
      'Deepgram',
      `model=${cfg.model} reqId=${requestId} latency=${Date.now() - t0}ms confidence=${confidence.toFixed(2)} bytes=${params.buffer.length}`,
    );

    if (!transcript || (confidence > 0 && confidence < 0.35)) {
      return '';
    }
    return transcript;
  } finally {
    clearTimeout(timer);
  }
}
