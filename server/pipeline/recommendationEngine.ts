import type {
  Battlecard,
  KnowledgeDoc,
  MeetingSession,
  Organisation,
  SalesInsight,
  SignalEvent,
  SupportingSourceRef,
  TranscriptTurn,
} from '../../src/types/sales.ts';
import { salesAI } from '../ai.ts';
import { buildCooldownFingerprint, validateCitedSources } from '../signals.ts';
import type { ConversationContextSnapshot } from './contextManager.ts';
import type { RetrievedKnowledgeContext } from './knowledgeRetriever.ts';
import type { DetectedSignalResult } from './signalDetector.ts';
import { formatNowTime } from './transcriptProcessor.ts';

function computeConfidenceScore(certainty: 'high' | 'medium' | 'low', sourceCount: number): number {
  const base = certainty === 'high' ? 88 : certainty === 'medium' ? 68 : 42;
  return Math.min(98, base + Math.min(8, sourceCount * 3));
}

function enrichSupportingSources(
  verified: SupportingSourceRef[],
  retrieved: RetrievedKnowledgeContext,
  orgDocs: KnowledgeDoc[],
): SupportingSourceRef[] {
  return verified.map((src) => {
    const rankMatch = retrieved.rankedResults.find((r) => r.docId === src.documentId);
    const docMatch = orgDocs.find((d) => d.id === src.documentId);
    return {
      ...src,
      relevanceScore: rankMatch ? Math.round(rankMatch.score * 100) : undefined,
      sourceMode: docMatch?.sourceMode || 'uploaded_kb',
    };
  });
}

export function rankRecommendations(insights: SalesInsight[]): SalesInsight[] {
  const statusWeight: Record<string, number> = {
    evolving: 30,
    active: 20,
    monitoring: 10,
    resolved: 0,
  };
  const categoryWeight: Record<string, number> = {
    objection: 20,
    competitor: 18,
    risk: 15,
    technical_answer: 14,
    buying_signal: 12,
    discovery: 8,
    recommendation: 6,
  };

  for (const ins of insights) {
    const stW = statusWeight[ins.objectionStatus || 'active'] ?? 15;
    const catW = categoryWeight[ins.category] ?? 10;
    const confW = (ins.confidenceScore ?? 70) * 0.25;
    const evW = Math.min(10, (ins.evolutionCount || 1) * 3);
    ins.rankingScore = Math.round(stW + catW + confW + evW);
  }

  return [...insights].sort((a, b) => {
    if (Boolean(a.dismissed) !== Boolean(b.dismissed)) {
      return a.dismissed ? 1 : -1;
    }
    if ((a.objectionStatus === 'resolved') !== (b.objectionStatus === 'resolved')) {
      return a.objectionStatus === 'resolved' ? 1 : -1;
    }
    const timeA = a.updatedAt || a.createdAt;
    const timeB = b.updatedAt || b.createdAt;
    if (timeB !== timeA) return timeB.localeCompare(timeA);
    return (b.rankingScore || 0) - (a.rankingScore || 0);
  });
}

export async function generateAndRankRecommendations(params: {
  org: Organisation;
  meeting: MeetingSession;
  latestTurn: TranscriptTurn;
  signal: DetectedSignalResult;
  context: ConversationContextSnapshot;
  retrieved: RetrievedKnowledgeContext;
  battlecard?: Battlecard;
  orgDocs: KnowledgeDoc[];
  startMs: number;
}): Promise<{
  createdOrUpdatedInsights: SalesInsight[];
  evolved: boolean;
}> {
  const {
    org,
    meeting,
    latestTurn,
    signal,
    context,
    retrieved,
    battlecard,
    orgDocs,
    startMs,
  } = params;

  const existingInsight = context.matchedExistingInsight;
  const evolvingExcerpts = existingInsight
    ? [
        ...(existingInsight.contextHistory || [
          {
            excerpt: existingInsight.trigger.transcriptExcerpt,
            speakerName: existingInsight.trigger.speakerName,
            timestamp: existingInsight.trigger.timestamp,
          },
        ]).map((c) => c.excerpt),
        latestTurn.text,
      ]
    : undefined;

  // Call Groq AI with full evolving context + ranked KB chunks
  const analysis = await salesAI.analyzeTurn({
    meeting,
    latestTurn,
    deterministicSignals: {
      matchedCompetitors: signal.matchedCompetitors,
      likelyObjectionCategory: signal.objectionCategory,
      isAmbiguousHesitation: signal.isHesitationOrRisk,
      isTechnicalQuestion: signal.isIntegrationConcern || latestTurn.text.includes('?'),
      isBuyingSignal: signal.isBuyingSignal,
      hasAnyTrigger: signal.hasSignal,
    },
    evolvingObjectionExcerpts: evolvingExcerpts,
    retrievedChunks: retrieved.chunksForPrompt,
    relevantBattlecard: battlecard,
    qualificationFields: org.settings.qualificationFramework,
    abstentionEnabled: org.settings.abstentionEnabled,
    conversationState: context.conversationState,
  });

  // Abort cleanly if meeting was reset while AI analysis was in flight
  if (!meeting.transcript.some((t) => t.id === latestTurn.id)) {
    return { createdOrUpdatedInsights: [], evolved: false };
  }

  latestTurn.detectedTags =
    analysis.detectedTags.length > 0 ? analysis.detectedTags : signal.tags;
  latestTurn.sentimentScore = analysis.sentimentScore;

  const normalizedSentiment = Math.round(((analysis.sentimentScore + 1) / 2) * 100);
  meeting.sentimentTrend = [...meeting.sentimentTrend.slice(-11), normalizedSentiment];

  if (analysis.coveredQualificationFields.length > 0) {
    for (const qItem of meeting.qualification) {
      if (
        analysis.coveredQualificationFields.some(
          (f) => f.toLowerCase() === qItem.field.toLowerCase(),
        )
      ) {
        qItem.covered = true;
        if (!qItem.evidence) {
          qItem.evidence = latestTurn.text.slice(0, 120);
        }
      }
    }
  }

  const lifecycleId = signal.lifecycleKey
    ? `${meeting.id}::${signal.lifecycleKey}`
    : undefined;

  // Update or record SignalEvent in Centre Section
  const nowStr = formatNowTime();
  const primarySignalType = signal.primaryType || analysis.insights[0]?.category || 'objection';
  const primaryCategoryLabel =
    signal.objectionCategory || analysis.insights[0]?.objectionCategory || primarySignalType;

  if (context.matchedExistingSignal) {
    const existingSig = context.matchedExistingSignal;
    existingSig.status = 'evolving';
    existingSig.evidenceExcerpt = latestTurn.text;
    existingSig.updatedAt = nowStr;
    existingSig.excerpts = [
      ...(existingSig.excerpts || [
        {
          excerpt: existingSig.evidenceExcerpt,
          speakerName: latestTurn.speakerName,
          timestamp: existingSig.createdAt,
          turnId: existingSig.turnId,
        },
      ]),
      {
        excerpt: latestTurn.text,
        speakerName: latestTurn.speakerName,
        timestamp: latestTurn.timestamp,
        turnId: latestTurn.id,
      },
    ];
    existingSig.confidenceScore = Math.max(
      existingSig.confidenceScore || 80,
      signal.confidenceScore || 85,
    );
  } else {
    const newSig: SignalEvent = {
      id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      organisationId: org.id,
      meetingId: meeting.id,
      lifecycleId,
      turnId: latestTurn.id,
      signalType: primarySignalType,
      category: primaryCategoryLabel,
      entityName: signal.matchedCompetitors[0]?.canonicalName,
      certainty: signal.confidenceScore >= 80 ? 'high' : 'medium',
      confidenceScore: signal.confidenceScore || 82,
      explicitOrInferred: signal.isHesitationOrRisk && !signal.objectionCategory ? 'inferred' : 'explicit',
      evidenceExcerpt: latestTurn.text,
      excerpts: [
        {
          excerpt: latestTurn.text,
          speakerName: latestTurn.speakerName,
          timestamp: latestTurn.timestamp,
          turnId: latestTurn.id,
        },
      ],
      status: 'active',
      suppressedByCooldown: false,
      createdAt: latestTurn.timestamp,
      updatedAt: nowStr,
    };
    meeting.signals.push(newSig);
  }

  const createdOrUpdatedInsights: SalesInsight[] = [];
  let evolved = false;

  if (analysis.shouldRecommend && analysis.insights.length > 0) {
    const ins = analysis.insights[0];
    const verifiedRaw = validateCitedSources(
      ins.citedDocIds,
      retrieved.chunksForPrompt,
      org.id,
    );

    // If the model cited no docIds directly despite retrieved chunks existing, attach top ranked evidence chunk transparently
    const fallbackVerified: SupportingSourceRef[] =
      verifiedRaw.length > 0
        ? verifiedRaw
        : retrieved.rankedResults.slice(0, 2).map((r) => ({
            documentId: r.docId,
            title: r.docTitle,
            section: r.sectionTitle || r.category,
            excerpt: r.content.slice(0, 220),
          }));

    const verifiedSources = enrichSupportingSources(
      verifiedRaw.length > 0 ? verifiedRaw : ins.abstained ? [] : fallbackVerified,
      retrieved,
      orgDocs,
    );

    const shouldAbstain =
      ins.abstained ||
      (org.settings.abstentionEnabled &&
        (ins.category === 'technical_answer' || ins.category === 'competitor') &&
        verifiedSources.length === 0 &&
        !battlecard);

    const limitations = [...(ins.limitations || [])];
    if (shouldAbstain && limitations.length === 0) {
      limitations.push(
        'No approved Knowledge Base document verified this claim. Confirm with Solutions Engineering before committing.',
      );
    }

    const latencyMs = Date.now() - startMs;
    const confidenceScore = computeConfidenceScore(
      shouldAbstain ? 'low' : ins.certainty,
      verifiedSources.length,
    );

    if (existingInsight) {
      // TASK 2: Maintain original objection, update context, refine recommendation, NO duplicate card!
      evolved = true;
      const prevHistory = existingInsight.contextHistory || [
        {
          excerpt: existingInsight.trigger.transcriptExcerpt,
          speakerName: existingInsight.trigger.speakerName,
          timestamp: existingInsight.trigger.timestamp,
        },
      ];
      existingInsight.contextHistory = [
        ...prevHistory,
        {
          excerpt: latestTurn.text,
          speakerName: latestTurn.speakerName,
          timestamp: latestTurn.timestamp,
          turnId: latestTurn.id,
        },
      ];
      existingInsight.evolutionCount = (existingInsight.evolutionCount || 1) + 1;
      existingInsight.objectionStatus = 'evolving';
      existingInsight.title = ins.title || existingInsight.title;
      existingInsight.objectionDetected =
        ins.objectionDetected || existingInsight.objectionDetected || existingInsight.title;
      existingInsight.underlyingConcern = ins.underlyingConcern || ins.interpretation;
      existingInsight.interpretation = ins.interpretation;
      existingInsight.recommendedApproach = ins.recommendedApproach || ins.suggestedAction;
      existingInsight.suggestedAction = ins.suggestedAction;
      existingInsight.suggestedResponse = shouldAbstain ? undefined : ins.suggestedResponse;
      existingInsight.discoveryQuestion = ins.discoveryQuestion || existingInsight.discoveryQuestion;
      existingInsight.differentiator = ins.differentiator || existingInsight.differentiator;
      existingInsight.competitorName =
        ins.competitorName ||
        signal.matchedCompetitors[0]?.canonicalName ||
        existingInsight.competitorName ||
        battlecard?.competitorName;
      existingInsight.competitorWeaknesses =
        battlecard?.theirWeaknesses?.slice(0, 3) || existingInsight.competitorWeaknesses;
      existingInsight.conversationBasis = context.conversationBasis;
      existingInsight.supportingSources =
        verifiedSources.length > 0 ? verifiedSources : existingInsight.supportingSources;
      existingInsight.limitations = limitations;
      existingInsight.abstained = shouldAbstain;
      existingInsight.certainty = shouldAbstain ? 'low' : ins.certainty;
      existingInsight.confidenceScore = confidenceScore;
      existingInsight.retrievalMode = retrieved.retrievalMode;
      existingInsight.latencyMs = latencyMs;
      existingInsight.updatedAt = nowStr;
      meeting.suppressedDuplicatesCount += 1;

      createdOrUpdatedInsights.push(existingInsight);
    } else {
      const entityKey =
        ins.competitorName || ins.objectionCategory || ins.title || ins.category;
      const fingerprint = buildCooldownFingerprint(meeting.id, ins.category, entityKey);

      const newInsight: SalesInsight = {
        id: `ins-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        organisationId: org.id,
        meetingId: meeting.id,
        accountName: meeting.accountName,
        lifecycleId,
        objectionStatus: 'active',
        evolutionCount: 1,
        category: ins.category,
        objectionCategory: ins.objectionCategory || signal.objectionCategory,
        objectionDetected: ins.objectionDetected || ins.title,
        title: ins.title,
        trigger: {
          transcriptExcerpt: latestTurn.text,
          speaker: latestTurn.speaker,
          speakerName: latestTurn.speakerName,
          timestamp: latestTurn.timestamp,
        },
        contextHistory: [
          {
            excerpt: latestTurn.text,
            speakerName: latestTurn.speakerName,
            timestamp: latestTurn.timestamp,
            turnId: latestTurn.id,
          },
        ],
        underlyingConcern: ins.underlyingConcern || ins.interpretation,
        interpretation: ins.interpretation,
        certainty: shouldAbstain ? 'low' : ins.certainty,
        confidenceScore,
        explicitOrInferred: ins.explicitOrInferred,
        recommendedApproach: ins.recommendedApproach || ins.suggestedAction,
        suggestedAction: shouldAbstain
          ? 'Acknowledge the concern and confirm exact details with Solutions Engineering after the call.'
          : ins.suggestedAction,
        suggestedResponse: shouldAbstain ? undefined : ins.suggestedResponse,
        discoveryQuestion: ins.discoveryQuestion,
        differentiator: ins.differentiator,
        competitorName:
          ins.competitorName ||
          signal.matchedCompetitors[0]?.canonicalName ||
          battlecard?.competitorName,
        competitorWeaknesses: battlecard?.theirWeaknesses?.slice(0, 3),
        conversationBasis: context.conversationBasis,
        supportingSources: verifiedSources,
        limitations,
        abstained: shouldAbstain,
        retrievalMode: retrieved.retrievalMode,
        fingerprint,
        latencyMs,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      meeting.insights.unshift(newInsight);
      createdOrUpdatedInsights.push(newInsight);
    }
  }

  meeting.insights = rankRecommendations(meeting.insights);

  return { createdOrUpdatedInsights, evolved };
}
