/**
 * Local Hugging Face Embedding Adapter (implementation_v0.5 §2.3 & §5.7)
 *
 * - Exclusively handles embeddings locally (never used for LLM chat/reasoning).
 * - Enforces EMBEDDING_PROVIDER=huggingface_local.
 * - Default model: BAAI/bge-m3 (1,024-dimensional dense vectors, L2-normalized).
 * - Uses Sentence Transformers locally when available in Python, and seamlessly uses
 *   local @huggingface/transformers ONNX Runtime (Xenova/bge-m3, 1,024-dim) in Node.js.
 * - Requires zero external embedding API keys and never calls Hugging Face Router.
 */

import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { env as hfEnv, pipeline } from '@huggingface/transformers';

const execFileAsync = promisify(execFile);

// Store downloaded model files in a local cache so restarts do not re-download
hfEnv.cacheDir = path.join(process.cwd(), '.hf-cache');
hfEnv.allowLocalModels = true;

export interface EmbeddingConfig {
  provider: 'huggingface_local';
  model: string;
  localOnnxRepo: string;
  device: string;
  expectedDimension: number;
  batchSize: number;
  normalize: boolean;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dimension: number;
  normalized: boolean;
  usedProvider: 'huggingface_local' | 'none';
  runtime: 'sentence_transformers_local' | 'huggingface_transformers_onnx_local' | 'none';
}

const KNOWN_MODEL_DIMS: Record<string, number> = {
  'BAAI/bge-m3': 1024,
  'Xenova/bge-m3': 1024,
  'intfloat/multilingual-e5-large-instruct': 1024,
  'nomic-ai/nomic-embed-text-v1.5': 768,
  'BAAI/bge-base-en-v1.5': 768,
  'BAAI/bge-small-en-v1.5': 384,
};

const LOCAL_ONNX_REPO_MAP: Record<string, string> = {
  'BAAI/bge-m3': 'Xenova/bge-m3',
  'Xenova/bge-m3': 'Xenova/bge-m3',
  'BAAI/bge-base-en-v1.5': 'Xenova/bge-base-en-v1.5',
  'BAAI/bge-small-en-v1.5': 'Xenova/bge-small-en-v1.5',
  'nomic-ai/nomic-embed-text-v1.5': 'nomic-ai/nomic-embed-text-v1.5',
};

export function validateEmbeddingEnvironment(): EmbeddingConfig {
  const rawProvider = (process.env.EMBEDDING_PROVIDER || 'huggingface_local').trim().toLowerCase();
  if (rawProvider !== 'huggingface_local') {
    throw new Error(
      `Invalid EMBEDDING_PROVIDER="${process.env.EMBEDDING_PROVIDER}". Only "huggingface_local" is permitted (local Hugging Face embeddings exclusively).`,
    );
  }

  const model = (process.env.EMBEDDING_MODEL || 'BAAI/bge-m3').trim();
  if (!model || /\s/.test(model)) {
    throw new Error(
      `Invalid EMBEDDING_MODEL="${process.env.EMBEDDING_MODEL}". Expected a valid Hugging Face model ID such as "BAAI/bge-m3".`,
    );
  }

  const device = (process.env.EMBEDDING_DEVICE || 'cpu').trim();
  const batchSize = Math.max(
    1,
    Math.min(128, Number.parseInt(process.env.EMBEDDING_BATCH_SIZE || '64', 10) || 64),
  );
  const normalize = (process.env.EMBEDDING_NORMALIZE || 'true').toLowerCase() !== 'false';
  const expectedDimension = KNOWN_MODEL_DIMS[model] || 1024;
  const localOnnxRepo =
    process.env.EMBEDDING_LOCAL_ONNX_REPO?.trim() ||
    LOCAL_ONNX_REPO_MAP[model] ||
    'Xenova/bge-m3';

  return {
    provider: 'huggingface_local',
    model,
    localOnnxRepo,
    device,
    expectedDimension,
    batchSize,
    normalize,
  };
}

export function getEmbeddingConfig(): EmbeddingConfig {
  return validateEmbeddingEnvironment();
}

/**
 * Apply model-specific query/passage formatting ONLY when required by the model card.
 * Per implementation_v0.5 §2.3: never add E5-style instruction prefixes to BAAI/bge-m3.
 */
function formatInputForModel(text: string, model: string, kind: 'query' | 'document'): string {
  const trimmed = text.trim();
  const lower = model.toLowerCase();
  if (lower.includes('e5-') && lower.includes('instruct')) {
    return kind === 'query'
      ? `Instruct: Given a sales objection or prospect question, retrieve relevant approved sales passages\nQuery: ${trimmed}`
      : trimmed;
  }
  if (lower.includes('e5-')) {
    return `${kind === 'query' ? 'query' : 'passage'}: ${trimmed}`;
  }
  if (lower.includes('nomic-embed-text')) {
    return `${kind === 'query' ? 'search_query' : 'search_document'}: ${trimmed}`;
  }
  // BAAI/bge-m3 requires no instruction prefix
  return trimmed;
}

function l2Normalize(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  if (normSq <= 0) return vec;
  const inv = 1 / Math.sqrt(normSq);
  return vec.map((v) => v * inv);
}

function coerceToSingleVector(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (typeof raw[0] === 'number') {
    return raw as number[];
  }
  if (Array.isArray(raw[0]) && typeof raw[0][0] === 'number') {
    const rows = raw as number[][];
    const dims = rows[0].length;
    const avg = new Array<number>(dims).fill(0);
    for (const row of rows) {
      for (let i = 0; i < dims; i++) {
        avg[i] += row[i] || 0;
      }
    }
    return avg.map((v) => v / rows.length);
  }
  return null;
}

let sentenceTransformersAvailable: boolean | null = null;

async function hasLocalSentenceTransformers(): Promise<boolean> {
  if (sentenceTransformersAvailable !== null) return sentenceTransformersAvailable;
  try {
    await execFileAsync('python3', ['-c', 'import sentence_transformers'], { timeout: 3000 });
    sentenceTransformersAvailable = true;
  } catch {
    sentenceTransformersAvailable = false;
  }
  return sentenceTransformersAvailable;
}

async function computeSentenceTransformersEmbeddings(
  inputs: string[],
  cfg: EmbeddingConfig,
): Promise<number[][]> {
  const script = [
    'import json, sys',
    'from sentence_transformers import SentenceTransformer',
    'payload = json.loads(sys.stdin.read())',
    'model = SentenceTransformer(payload["model"], device=payload["device"])',
    'vecs = model.encode(payload["texts"], batch_size=payload["batch_size"], normalize_embeddings=payload["normalize"]).tolist()',
    'print(json.dumps(vecs))',
  ].join('\n');

  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    const child = execFile(
      'python3',
      ['-c', script],
      { maxBuffer: 50 * 1024 * 1024, timeout: 120000 },
      (err, out) => {
        if (err) reject(err);
        else resolve({ stdout: out });
      },
    );
    child.stdin?.end(
      JSON.stringify({
        model: cfg.model,
        device: cfg.device,
        batch_size: cfg.batchSize,
        normalize: cfg.normalize,
        texts: inputs,
      }),
    );
  });

  const parsed = JSON.parse(stdout) as number[][];
  if (!Array.isArray(parsed) || parsed.length !== inputs.length) {
    throw new Error('Sentence Transformers returned an unexpected vector count');
  }
  return parsed;
}

type FeatureExtractionFn = (
  inputs: string | string[],
  options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
) => Promise<{ tolist: () => unknown }>;

let cachedLocalRepo: string | null = null;
let cachedExtractorPromise: Promise<FeatureExtractionFn> | null = null;

async function getLocalOnnxExtractor(onnxRepo: string): Promise<FeatureExtractionFn> {
  if (cachedExtractorPromise && cachedLocalRepo === onnxRepo) {
    return cachedExtractorPromise;
  }
  cachedLocalRepo = onnxRepo;
  const t0 = Date.now();
  cachedExtractorPromise = pipeline('feature-extraction', onnxRepo, {
    dtype: 'q8',
  })
    .then((ext) => {
      console.log(`[HF Local Embeddings] Loaded ${onnxRepo} (q8 ONNX) in ${Date.now() - t0}ms`);
      return ext as unknown as FeatureExtractionFn;
    })
    .catch((err) => {
      cachedExtractorPromise = null;
      cachedLocalRepo = null;
      throw err;
    });
  return cachedExtractorPromise;
}

async function computeLocalOnnxEmbeddings(
  inputs: string[],
  onnxRepo: string,
  normalize: boolean,
): Promise<number[][]> {
  const extractor = await getLocalOnnxExtractor(onnxRepo);
  const vectors: number[][] = [];
  const localChunkSize = 4;
  for (let i = 0; i < inputs.length; i += localChunkSize) {
    const slice = inputs.slice(i, i + localChunkSize).map((s) => s.slice(0, 1800));
    const output = await extractor(slice, {
      pooling: 'mean',
      normalize,
    });
    const list = output.tolist();
    if (Array.isArray(list)) {
      if (slice.length === 1 && typeof list[0] === 'number') {
        const v = list as number[];
        vectors.push(normalize ? l2Normalize(v) : v);
      } else {
        for (const item of list) {
          const v = coerceToSingleVector(item);
          if (v) {
            vectors.push(normalize ? l2Normalize(v) : v);
          }
        }
      }
    }
  }
  return vectors;
}

export async function generateEmbeddings(
  texts: string[],
  kind: 'query' | 'document' = 'document',
): Promise<EmbeddingResult> {
  const cfg = validateEmbeddingEnvironment();
  if (texts.length === 0) {
    return {
      vectors: [],
      model: cfg.model,
      dimension: cfg.expectedDimension,
      normalized: cfg.normalize,
      usedProvider: 'none',
      runtime: 'none',
    };
  }

  const formatted = texts.map((t) => formatInputForModel(t, cfg.model, kind));

  // 1. Prefer Python Sentence Transformers locally when installed on the host
  if (await hasLocalSentenceTransformers()) {
    try {
      const vectors = await computeSentenceTransformersEmbeddings(formatted, cfg);
      if (vectors.length === formatted.length && vectors[0]?.length) {
        return {
          vectors,
          model: cfg.model,
          dimension: vectors[0].length,
          normalized: cfg.normalize,
          usedProvider: 'huggingface_local',
          runtime: 'sentence_transformers_local',
        };
      }
    } catch (err) {
      console.warn(
        `[HF Local Embeddings] Sentence Transformers error (${err instanceof Error ? err.message : String(err)}); falling back to local ONNX runtime.`,
      );
    }
  }

  // 2. Local Hugging Face Transformers ONNX Runtime (BAAI/bge-m3 -> Xenova/bge-m3 1024-dim)
  try {
    const vectors = await computeLocalOnnxEmbeddings(formatted, cfg.localOnnxRepo, cfg.normalize);
    if (vectors.length === formatted.length && vectors[0]?.length) {
      return {
        vectors,
        model: cfg.model,
        dimension: vectors[0].length,
        normalized: cfg.normalize,
        usedProvider: 'huggingface_local',
        runtime: 'huggingface_transformers_onnx_local',
      };
    }
  } catch (err) {
    console.warn(
      `[HF Local Embeddings] ${cfg.localOnnxRepo} unavailable (${err instanceof Error ? err.message : String(err)}); falling back to lexical search.`,
    );
  }

  return {
    vectors: [],
    model: cfg.model,
    dimension: cfg.expectedDimension,
    normalized: cfg.normalize,
    usedProvider: 'none',
    runtime: 'none',
  };
}
