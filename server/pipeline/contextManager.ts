import type {
  ConversationState,
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
  conversationState: ConversationState;
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

function pushUnique(list: string[], item: string, maxItems = 8): void {
  const clean = item.trim();
  if (!clean) return;
  const lower = clean.toLowerCase();
  if (list.some((x) => x.toLowerCase() === lower)) return;
  list.unshift(clean);
  if (list.length > maxItems) list.length = maxItems;
}

function createInitialConversationState(meeting: MeetingSession): ConversationState {
  return {
    currentVendor:
      meeting.primaryCompetitor && meeting.primaryCompetitor !== 'None'
        ? meeting.primaryCompetitor
        : undefined,
    confirmedPainPoints: [],
    possiblePainPoints: [],
    desiredOutcomes: [],
    objections: [],
    buyingSignals: [],
    stakeholders: [...meeting.prospectStakeholders],
    budgetStatus: 'unknown',
    timelineStatus: 'unknown',
    decisionProcessStatus: 'unknown',
    discoveryGaps: meeting.qualification
      .filter((q) => !q.covered)
      .map((q) => q.field),
    openQuestions: [],
    updatedAt: new Date().toISOString(),
  };
}

function updateStructuredConversationState(params: {
  meeting: MeetingSession;
  latestTurn: TranscriptTurn;
  signal: DetectedSignalResult;
  sessionCompetitors: string[];
}): ConversationState {
  const { meeting, latestTurn, signal, sessionCompetitors } = params;
  const state: ConversationState = meeting.conversationState
    ? { ...meeting.conversationState }
    : createInitialConversationState(meeting);

  const text = latestTurn.text.trim();
  const lower = text.toLowerCase();
  const isProspect = latestTurn.speaker !== 'Sales Representative' && latestTurn.speaker !== 'AE';

  // Vendor / incumbent detection
  if (signal.matchedCompetitors.length > 0) {
    state.currentVendor = signal.matchedCompetitors[0].canonicalName;
  } else if (!state.currentVendor && sessionCompetitors.length > 0) {
    state.currentVendor = sessionCompetitors[0];
  }

  // Current workflow capture
  if (
    isProspect &&
    /\b(currently|right now|today we|our team uses|running on|pipeline|workflow|stack|ci\/cd|jenkins|github actions|gitlab)\b/i.test(
      text,
    )
  ) {
    state.currentWorkflow = text.slice(0, 140);
  }

  // Confirmed vs. possible pain points
  if (isProspect) {
    if (
      /\b(flaky|slow|pain|bottleneck|broken|drops|manual|spending \d+|hours a week|queue|latency|stale|overhead|struggl|frustrat|fails)\b/i.test(
        lower,
      )
    ) {
      pushUnique(state.confirmedPainPoints, text.slice(0, 120), 6);
    } else if (signal.isHesitationOrRisk) {
      pushUnique(state.possiblePainPoints, text.slice(0, 120), 5);
    }

    // Desired outcomes
    if (
      /\b(need to|want to|goal is|looking for|trying to|hoping to|cut|reduce|improve|speed up|consolidat|automate)\b/i.test(
        lower,
      )
    ) {
      pushUnique(state.desiredOutcomes, text.slice(0, 120), 6);
    }

    // Budget / Timeline / Decision Process tracking
    if (/\b(budget|price|cost|pricing|expensive|discount|spend|cfo|finance|roi|tco|quote)\b/i.test(lower)) {
      state.budgetStatus = /\b(approved|allocated|have budget|signed off)\b/i.test(lower)
        ? 'confirmed'
        : 'discussed';
    }
    if (/\b(q1|q2|q3|q4|quarter|deadline|go[- ]live|timeline|this month|next month|renewal|freeze|by [a-z]+)\b/i.test(lower)) {
      state.timelineStatus = /\b(target|must|by q|renewal is|go[- ]live on)\b/i.test(lower)
        ? 'confirmed'
        : 'discussed';
    }
    if (/\b(procurement|legal|infosec|security review|committee|vp|ciso|cto|sign[- ]off|approval|stakeholder|decision)\b/i.test(lower)) {
      state.decisionProcessStatus = /\b(steps|final sign|procurement then|ciso signs)\b/i.test(lower)
        ? 'confirmed'
        : 'discussed';
    }

    // Buying signals
    if (signal.isBuyingSignal) {
      pushUnique(state.buyingSignals, text.slice(0, 120), 6);
    }

    // Open prospect questions
    if (text.includes('?')) {
      pushUnique(state.openQuestions, text.slice(0, 120), 5);
    }

    // Stakeholders mentioned or speaking
    if (latestTurn.speakerName && !state.stakeholders.some((s) => s.toLowerCase().includes(latestTurn.speakerName.toLowerCase()))) {
      state.stakeholders.push(latestTurn.speakerName);
    }
  }

  // Objections sync
  if (signal.objectionCategory && isProspect) {
    const existingObj = state.objections.find(
      (o) => o.category === signal.objectionCategory && o.status !== 'resolved',
    );
    if (existingObj) {
      existingObj.summary = text.slice(0, 110);
      existingObj.status = 'evolving';
    } else {
      state.objections.unshift({
        category: signal.objectionCategory,
        summary: text.slice(0, 110),
        status: 'active',
      });
      if (state.objections.length > 8) state.objections.length = 8;
    }
  }
  if (signal.isResolutionEvidence) {
    for (const obj of state.objections) {
      if (!signal.resolvedCategoryHint || obj.category === signal.resolvedCategoryHint) {
        obj.status = 'resolved';
      }
    }
  }

  // Recompute discovery gaps from uncovered qualification fields + unknown B/T/D
  const uncoveredQual = meeting.qualification.filter((q) => !q.covered).map((q) => q.field);
  const gaps: string[] = [...uncoveredQual];
  if (state.budgetStatus === 'unknown' && !gaps.some((g) => g.toLowerCase().includes('budget') || g.toLowerCase().includes('economic'))) {
    gaps.push('Budget / Commercial Scope');
  }
  if (state.timelineStatus === 'unknown' && !gaps.some((g) => g.toLowerCase().includes('time'))) {
    gaps.push('Target Timeline');
  }
  if (state.decisionProcessStatus === 'unknown' && !gaps.some((g) => g.toLowerCase().includes('decision'))) {
    gaps.push('Decision Process');
  }
  state.discoveryGaps = gaps.slice(0, 7);
  state.updatedAt = new Date().toISOString();

  meeting.conversationState = state;
  return state;
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

  // 4. Update structured conversation state (§6.4)
  const conversationState = updateStructuredConversationState({
    meeting,
    latestTurn,
    signal,
    sessionCompetitors: seenComps,
  });

  // 5. Build recent window & active lifecycle summaries
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
    conversationState,
    activeLifecycles,
    matchedExistingInsight,
    matchedExistingSignal,
    isEvolvingLifecycle,
    resolvedInsightIds,
  };
}
