import type { Battlecard, MeetingSession, SalesInsight } from '../../src/types/sales.ts';
import { store } from '../store.ts';
import { buildAndManageConversationContext } from './contextManager.ts';
import { retrieveAndRankKnowledge } from './knowledgeRetriever.ts';
import { generateAndRankRecommendations } from './recommendationEngine.ts';
import { detectConversationSignals } from './signalDetector.ts';
import { processIncomingTranscriptEvent } from './transcriptProcessor.ts';

function findRelevantBattlecard(
  battlecards: Battlecard[],
  meeting: MeetingSession,
  matchedCompetitors: { canonicalName: string }[],
  sessionCompetitors: string[],
): Battlecard | undefined {
  if (matchedCompetitors.length > 0) {
    const target = matchedCompetitors[0].canonicalName.toLowerCase();
    return battlecards.find(
      (b) =>
        b.competitorName.toLowerCase() === target ||
        (b.aliases || []).some((a) => a.toLowerCase() === target),
    );
  }
  for (const sc of sessionCompetitors) {
    const found = battlecards.find(
      (b) =>
        b.competitorName.toLowerCase() === sc.toLowerCase() ||
        (b.aliases || []).some((a) => a.toLowerCase() === sc.toLowerCase()),
    );
    if (found) return found;
  }
  return battlecards.find(
    (bc) => bc.competitorName.toLowerCase() === meeting.primaryCompetitor.toLowerCase(),
  );
}

export async function runLiveIntelligencePipeline(params: {
  meeting: MeetingSession;
  speaker?: string;
  speakerName?: string;
  text: string;
  eventId?: string;
  onTranscriptAccepted?: (meeting: MeetingSession, analyzing: boolean) => void;
}): Promise<{
  meeting: MeetingSession;
  deduplicated: boolean;
  hasSignal: boolean;
  evolved: boolean;
  insights: SalesInsight[];
}> {
  const { meeting, speaker, speakerName, text, eventId, onTranscriptAccepted } = params;
  const startMs = Date.now();
  const org = store.getOrganisation(meeting.organisationId);
  const state = store.getState();

  // Stage 1: Transcript Event Processing
  const { turn, deduplicated } = processIncomingTranscriptEvent({
    meeting,
    speaker,
    speakerName,
    text,
    eventId,
  });

  if (deduplicated || !turn) {
    return { meeting, deduplicated: true, hasSignal: false, evolved: false, insights: [] };
  }

  const orgBattlecards = state.battlecards.filter((b) => b.organisationId === org.id);
  const orgDocs = state.knowledgeDocs.filter((d) => d.organisationId === org.id);

  // Stage 2 & 3: Signal Detection & Objection Classification
  const signal = detectConversationSignals({
    text: turn.text,
    speaker: turn.speaker,
    battlecards: orgBattlecards,
  });

  // Stage 4: Conversation Context & Evolving Lifecycle Management
  const context = buildAndManageConversationContext({
    meeting,
    latestTurn: turn,
    signal,
  });

  if (signal.tags.length > 0) {
    turn.detectedTags = signal.tags;
  }

  // Strictly obey TASK 7: Do NOT generate recommendations without a relevant signal!
  if (!signal.hasSignal) {
    store.save();
    onTranscriptAccepted?.(meeting, false);
    return { meeting, deduplicated: false, hasSignal: false, evolved: false, insights: [] };
  }

  // Notify client immediately that a relevant signal triggered RAG + Recommendation generation
  store.save();
  onTranscriptAccepted?.(meeting, true);

  // Stage 5: RAG Knowledge Retrieval & Evidence Ranking
  const tRag = Date.now();
  const retrieved = await retrieveAndRankKnowledge({
    organisationId: org.id,
    latestText: turn.text,
    signal,
    context,
    topK: 5,
  });
  console.log(`[Pipeline] RAG retrieved ${retrieved.rankedResults.length} chunks (${retrieved.retrievalMode}) in ${Date.now() - tRag}ms`);

  const battlecard = findRelevantBattlecard(
    orgBattlecards,
    meeting,
    signal.matchedCompetitors,
    context.sessionCompetitors,
  );

  // Stage 6 & 7: Recommendation Generation, Evolving Lifecycle Merge & Ranking
  const { createdOrUpdatedInsights, evolved } = await generateAndRankRecommendations({
    org,
    meeting,
    latestTurn: turn,
    signal,
    context,
    retrieved,
    battlecard,
    orgDocs,
    startMs,
  });

  store.save();
  return {
    meeting,
    deduplicated: false,
    hasSignal: true,
    evolved,
    insights: createdOrUpdatedInsights,
  };
}
