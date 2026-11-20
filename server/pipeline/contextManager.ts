import type {
  MeetingSession,
  SalesInsight,
  SignalEvent,
  TranscriptTurn,
} from '../../src/types/sales.ts';
import type { DetectedSignalResult } from './signalDetector.ts';

export interface ConversationContextSnapshot {
  recentTurnsText: string;
  sessionCompetitors: string[];
  conversationBasis: string;
  activeLifecycles: {
    lifecycleId: string;
    category: string;
    excerpts: string[];
  }[];
  matchedExistingInsight?: SalesInsight;
  matchedExistingSignal?: SignalEvent;
  isEvolvingLifecycle: boolean;
  resolvedInsightIds: string[];
}

export function buildAndManageConversationContext(params: {
  meeting: MeetingSession;
  latestTurn: TranscriptTurn;
  signal: DetectedSignalResult;
}): ConversationContextSnapshot {
  const { meeting, latestTurn, signal } = params;
  const resolvedInsightIds: string[] = [];

  // 1. Check for conversational resolution evidence on any active/evolving objection
  if (signal.isResolutionEvidence) {
    const hint = signal.resolvedCategoryHint;
    for (const sig of meeting.signals) {
      const matchesHint = !hint || sig.category === hint;
      if (
        matchesHint &&
        sig.status !== 'resolved' &&
        (sig.signalType === 'objection' || sig.signalType === 'competitor' || sig.signalType === 'risk')
      ) {
        sig.status = 'resolved';
        sig.updatedAt = latestTurn.timestamp;
      }
    }
    for (const ins of meeting.insights) {
      const matchesHint = !hint || ins.objectionCategory === hint;
      if (
        matchesHint &&
        !ins.dismissed &&
        ins.objectionStatus !== 'resolved' &&
        (ins.category === 'objection' || ins.category === 'competitor' || ins.category === 'risk')
      ) {
        ins.objectionStatus = 'resolved';
        ins.updatedAt = latestTurn.timestamp;
        resolvedInsightIds.push(ins.id);
      }
    }
  }

  // 2. Match incoming signal to an ongoing lifecycle (prevents duplicate cards for evolving objections)
  const targetLifecycleId = signal.lifecycleKey
    ? `${meeting.id}::${signal.lifecycleKey}`
    : undefined;

  const matchedExistingInsight = targetLifecycleId
    ? meeting.insights.find(
        (ins) =>
          !ins.dismissed &&
          ins.lifecycleId === targetLifecycleId &&
          ins.objectionStatus !== 'resolved',
      )
    : undefined;

  const matchedExistingSignal = targetLifecycleId
    ? meeting.signals.find(
        (sig) =>
          sig.lifecycleId === targetLifecycleId && sig.status !== 'resolved',
      )
    : undefined;

  const isEvolvingLifecycle = Boolean(matchedExistingInsight || matchedExistingSignal);

  // 3. Collect all competitors mentioned so far in the conversation (most recent first)
  const seenComps: string[] = [];
  const pushComp = (name?: string) => {
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!seenComps.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      seenComps.push(trimmed);
    }
  };
  for (const mc of signal.matchedCompetitors) {
    pushComp(mc.canonicalName);
  }
  for (let i = meeting.signals.length - 1; i >= 0; i--) {
    const s = meeting.signals[i];
    if (s.signalType === 'competitor' || s.entityName) {
      pushComp(s.entityName);
    }
  }
  for (const ins of meeting.insights) {
    pushComp(ins.competitorName);
  }

  // 4. Build recent window & active lifecycle summaries
  const recentTurnsText = meeting.transcript
    .slice(-8)
    .map((t) => `[${t.timestamp}] ${t.speaker} (${t.speakerName}): ${t.text}`)
    .join('\n');

  const activeLifecycles = meeting.insights
    .filter((ins) => !ins.dismissed && ins.objectionStatus !== 'resolved' && ins.lifecycleId)
    .map((ins) => ({
      lifecycleId: ins.lifecycleId!,
      category: ins.objectionCategory || ins.category,
      excerpts: (ins.contextHistory || [{ excerpt: ins.trigger.transcriptExcerpt }]).map(
        (e) => e.excerpt,
      ),
    }));

  const turnCount = meeting.transcript.length;
  const basisParts: string[] = [`Turn ${turnCount} of ${meeting.accountName} call`];
  if (seenComps.length > 0) {
    basisParts.push(`Competitor context: ${seenComps[0]}`);
  }
  if (matchedExistingInsight) {
    basisParts.push(
      `Evolving thread (${(matchedExistingInsight.evolutionCount || 1) + 1} related statements)`,
    );
  } else if (activeLifecycles.length > 0) {
    basisParts.push(`${activeLifecycles.length} active thread(s) in session`);
  }

  return {
    recentTurnsText,
    sessionCompetitors: seenComps,
    conversationBasis: basisParts.join(' · '),
    activeLifecycles,
    matchedExistingInsight,
    matchedExistingSignal,
    isEvolvingLifecycle,
    resolvedInsightIds,
  };
}
