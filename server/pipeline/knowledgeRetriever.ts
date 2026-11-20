import type { KnowledgeChunk, RagSearchResult } from '../../src/types/sales.ts';
import type { ConversationContextSnapshot } from './contextManager.ts';
import type { DetectedSignalResult } from './signalDetector.ts';
import { store } from '../store.ts';

export interface RetrievedKnowledgeContext {
  query: string;
  retrievalMode: 'mock_kb_lexical' | 'hybrid_rag_embeddings';
  rankedResults: RagSearchResult[];
  chunksForPrompt: KnowledgeChunk[];
}

export async function retrieveAndRankKnowledge(params: {
  organisationId: string;
  latestText: string;
  signal: DetectedSignalResult;
  context: ConversationContextSnapshot;
  topK?: number;
}): Promise<RetrievedKnowledgeContext> {
  const { organisationId, latestText, signal, context, topK = 5 } = params;

  // 1. Convert objection + evolving conversation context into a focused retrieval query
  const queryParts: string[] = [latestText];
  if (signal.objectionCategory) {
    queryParts.push(signal.objectionCategory);
  }
  if (signal.matchedCompetitors.length > 0) {
    queryParts.push(signal.matchedCompetitors.map((c) => c.canonicalName).join(' '));
  } else if (context.sessionCompetitors.length > 0) {
    queryParts.push(context.sessionCompetitors[0]);
  }
  if (context.matchedExistingInsight?.contextHistory) {
    queryParts.push(
      context.matchedExistingInsight.contextHistory.map((h) => h.excerpt).join(' '),
    );
  }
  const query = queryParts.join(' | ');

  // 2. Retrieve from tenant-scoped approved knowledge base (hybrid vector + lexical + rerank)
  const rankedResults = await store.searchKnowledge(organisationId, query, topK, {
    includeDrafts: false,
  });

  // 3. Determine transparent retrieval mode based on whether Hugging Face embeddings were used
  const usedVectors = rankedResults.some((r) => Boolean(r.embeddingModel));
  const retrievalMode: RetrievedKnowledgeContext['retrievalMode'] = usedVectors
    ? 'hybrid_rag_embeddings'
    : 'mock_kb_lexical';

  const chunksForPrompt: KnowledgeChunk[] = rankedResults.map((r, idx) => ({
    id: r.chunkId,
    organisationId,
    docId: r.docId,
    docTitle: r.docTitle,
    category: r.category,
    sectionTitle: r.sectionTitle,
    headingPath: r.headingPath,
    pageNumber: r.pageNumber,
    tokenCount: r.tokenCount,
    embeddingModel: r.embeddingModel,
    chunkIndex: idx,
    content: r.content,
  }));

  return {
    query,
    retrievalMode,
    rankedResults,
    chunksForPrompt,
  };
}
