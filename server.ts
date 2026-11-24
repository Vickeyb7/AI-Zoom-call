import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import mammoth from 'mammoth';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { getAiRuntimeInfo, salesAI, validateAiEnvironment } from './server/ai.ts';
import { getEmbeddingConfig } from './server/embeddings.ts';
import { logger } from './server/logger.ts';
import { MissingDeepgramKeyError } from './server/stt.ts';
import {
  classifyZoomSpeaker,
  dispatchRecallBot,
  isValidZoomMeetingUrl,
  leaveRecallBot,
  normalizeZoomWebhookPayload,
  resolveRecallBaseUrl,
  verifyZoomWebhookSignature,
} from './server/integrations/zoom.ts';
import { runLiveIntelligencePipeline } from './server/pipeline/orchestrator.ts';
import {
  chunkTextWithSections,
  computeSha256,
  extractHtmlText,
  extractPptxText,
  store,
} from './server/store.ts';
import type {
  Battlecard,
  CopilotPreferences,
  CopilotSessionMode,
  FeedbackRating,
  KnowledgeApprovalStatus,
  KnowledgeCategory,
  KnowledgeChunk,
  KnowledgeDoc,
  KnowledgeSensitivity,
  MeetingSession,
  Organisation,
  QuickAnswerItem,
  QuickAnswerSpeed,
  QuickAnswerStyle,
  SentimentTimelineSegment,
  SessionContextConfig,
  SpeakerRole,
  TranscriptTurn,
  UserProfile,
} from './src/types/sales.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function formatNowTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

function resolveRequestContext(req: express.Request): {
  org: Organisation;
  user: UserProfile;
} {
  const state = store.getState();
  const requestedOrgId = req.header('x-org-id') || 'org-acme';
  const org = state.organisations.find((o) => o.id === requestedOrgId) || state.organisations[0];
  const requestedUserId = req.header('x-user-id');
  const baseUser =
    state.users.find((u) => u.id === requestedUserId && u.organisationId === org.id) ||
    state.users.find((u) => u.organisationId === org.id) ||
    state.users[0];

  const authName = req.header('x-auth-name')?.trim();
  const authEmail = req.header('x-auth-email')?.trim();
  const user: UserProfile =
    authName || authEmail
      ? {
          ...baseUser,
          name: authName || baseUser.name,
          email: authEmail || baseUser.email,
        }
      : baseUser;

  return { org, user };
}

async function startServer() {
  const validatedAi = validateAiEnvironment();
  logger.info(
    'Startup',
    `LLM=${validatedAi.llmProvider} (${validatedAi.llmModel}, fast=${validatedAi.fastModel}, base=${validatedAi.groqBaseUrl}) | Embeddings=${validatedAi.embeddingProvider} (${validatedAi.embeddingModel}, ${validatedAi.embeddingDimension}d, device=${validatedAi.embeddingDevice}) | STT=${validatedAi.sttProvider} (${validatedAi.sttModel}) | Retention=${validatedAi.transcriptRetentionDays}d (${validatedAi.transcriptRetentionMode}) | LogLevel=${validatedAi.logLevel}`,
  );
  if (validatedAi.missingRequiredEnvVars.length > 0) {
    for (const missing of validatedAi.missingRequiredEnvVars) {
      logger.warn(
        'EnvValidation',
        `Missing required environment variable ${missing.name}: ${missing.purpose}`,
      );
    }
  }

  const app = express();
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const clientRooms = new Map<WebSocket, { meetingId: string; orgId: string }>();

  function broadcastToMeeting(meetingId: string, payload: unknown): void {
    const serialized = JSON.stringify(payload);
    for (const [ws, info] of clientRooms.entries()) {
      if (info.meetingId === meetingId && ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  }

  const autoSummaryInFlight = new Set<string>();

  function classifySentimentTone(
    score: number,
  ): SentimentTimelineSegment['tone'] {
    if (score >= 65) return 'Constructive';
    if (score >= 45) return 'Neutral';
    if (score >= 30) return 'Cautious';
    return 'Friction';
  }

  function buildSentimentSegmentsSnapshot(meeting: MeetingSession): SentimentTimelineSegment[] {
    const turns = meeting.transcript || [];
    if (turns.length === 0) return [];

    const targetSegments = Math.min(6, Math.max(2, Math.ceil(turns.length / 2)));
    const phaseNames = [
      'Opening',
      'Discovery',
      'Core Evaluation',
      'Objections & Trade-offs',
      'Alignment',
      'Closing',
    ];
    const segments: SentimentTimelineSegment[] = [];

    for (let i = 0; i < targetSegments; i++) {
      const startIdx = Math.floor((i * turns.length) / targetSegments);
      const endIdx = Math.max(startIdx + 1, Math.floor(((i + 1) * turns.length) / targetSegments));
      const slice = turns.slice(startIdx, endIdx);
      if (slice.length === 0) continue;

      const avgRaw =
        slice.reduce((sum, t) => sum + (typeof t.sentimentScore === 'number' ? t.sentimentScore : 0), 0) /
        slice.length;
      const score = Math.max(5, Math.min(98, Math.round(((avgRaw + 1) / 2) * 100)));

      const tags = slice.flatMap((t) => t.detectedTags || []).filter(Boolean);
      const topic = tags[0] || undefined;

      const label =
        i === 0
          ? 'Opening'
          : i === targetSegments - 1
          ? 'Closing'
          : topic
          ? topic.slice(0, 22)
          : phaseNames[Math.min(i, phaseNames.length - 1)];

      const firstTs = slice[0]?.timestamp;
      const lastTs = slice[slice.length - 1]?.timestamp;
      const timeRange =
        firstTs && lastTs && firstTs !== lastTs ? `${firstTs} – ${lastTs}` : firstTs;

      segments.push({
        index: segments.length + 1,
        label,
        timeRange,
        score,
        tone: classifySentimentTone(score),
        turnCount: slice.length,
        topic,
      });
    }

    return segments;
  }

  async function completeMeetingWithAutoSummary(params: {
    meeting: MeetingSession;
    user: UserProfile;
  }): Promise<void> {
    const { meeting, user } = params;
    meeting.status = 'completed';
    meeting.endedAt = meeting.endedAt || new Date().toISOString();

    // Snapshot privacy-safe per-segment sentiment metrics before retention purges raw transcript turns
    if (meeting.transcript.length > 0) {
      meeting.sentimentSegments = buildSentimentSegmentsSnapshot(meeting);
    }

    const hasSynthesizableContent =
      meeting.transcript.length > 0 ||
      meeting.insights.length > 0 ||
      Boolean(meeting.conversationState);

    if (!hasSynthesizableContent) {
      meeting.summaryStatus = 'idle';
      meeting.summaryError = undefined;
      store.enforceTranscriptRetention();
      store.save();
      broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
      return;
    }

    if (autoSummaryInFlight.has(meeting.id)) {
      broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
      return;
    }

    // Snapshot transcript in memory BEFORE privacy retention purges completed raw turns
    const snapshotForSynthesis: MeetingSession = {
      ...meeting,
      transcript: [...meeting.transcript],
      insights: [...meeting.insights],
      conversationState: meeting.conversationState ? { ...meeting.conversationState } : undefined,
    };

    autoSummaryInFlight.add(meeting.id);
    meeting.summaryStatus = 'generating';
    meeting.summaryError = undefined;
    store.save();
    broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });

    try {
      const generated = await salesAI.generateMeetingSummary(snapshotForSynthesis);
      meeting.executiveSummary = {
        ...generated,
        autoGenerated: true,
        generatedAt: new Date().toISOString(),
      };
      meeting.summaryStatus = 'ready';
      meeting.summaryError = undefined;
      store.logAudit({
        organisationId: meeting.organisationId,
        actorName: user.name,
        actorRole: user.role,
        action: 'meeting.auto_summarized',
        resource: `${meeting.accountName} (${generated.keyDecisions.length} decisions from ${generated.chunkCount} chunk(s))`,
      });
      logger.info(
        'AutoSummary',
        `meetingId=${meeting.id} decisions=${generated.keyDecisions.length} chunks=${generated.chunkCount}`,
      );
    } catch (err) {
      meeting.summaryStatus = 'failed';
      meeting.summaryError =
        err instanceof Error ? err.message : 'Auto-summary generation failed';
      logger.error(
        'AutoSummary',
        `meetingId=${meeting.id} failed: ${meeting.summaryError}`,
      );
    } finally {
      autoSummaryInFlight.delete(meeting.id);
      store.enforceTranscriptRetention();
      store.save();
      broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
    }
  }

  const quickAnswerInFlight = new Set<string>();
  const pendingQuickAnswer = new Map<
    string,
    { meeting: MeetingSession; user: UserProfile; question: string }
  >();

  function detectSpokenQuestionOrPrompt(text: string, meeting?: MeetingSession): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 10) return false;
    if (trimmed.includes('?')) return true;
    const lower = trimmed.toLowerCase();

    if (
      /^(how|what|why|when|where|who|which|can you|could you|would you|do you|does your|are you|have you|tell me|walk me through|explain|describe|compare|help me understand)\b/.test(
        lower,
      )
    ) {
      return true;
    }

    if (
      /\b(tell me about|walk me through|how does|how do you|what is your|why should|pric(e|ing)|expensive|cheaper|cost|budget|discount|renewal|quote|roi|payback|cfo|competitor|lambdatest|browserstack|sauce labs|apexcloud|security|soc\s?2|hipaa|gdpr|data residency|retention|byok|sso|saml|integration|latency|scale|architecture|design a|implement|migrat|switching|onboarding|timeline|deadline|worried|concern|blocker|hesitant|push back|procurement|legal|msa|redline|pilot|poc|proof of concept|sla|uptime|trade-off|tradeoff)\b/.test(
        lower,
      )
    ) {
      return true;
    }

    if (meeting) {
      const primaryComp = meeting.primaryCompetitor?.trim().toLowerCase();
      if (primaryComp && primaryComp.length >= 3 && primaryComp !== 'none identified' && lower.includes(primaryComp)) {
        return true;
      }
      const orgBattlecards = store
        .getState()
        .battlecards.filter((b) => b.organisationId === meeting.organisationId);
      for (const bc of orgBattlecards) {
        if (
          bc.competitorName.length >= 3 &&
          lower.includes(bc.competitorName.toLowerCase())
        ) {
          return true;
        }
        if (
          (bc.aliases || []).some((a) => a.trim().length >= 3 && lower.includes(a.trim().toLowerCase()))
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function triggerAutoQuickAnswer(meeting: MeetingSession, user: UserProfile, question: string) {
    if (quickAnswerInFlight.has(meeting.id)) {
      // Coalesce rapid back-to-back Zoom utterances so the salesperson always gets an answer for the latest question
      pendingQuickAnswer.set(meeting.id, { meeting, user, question });
      return;
    }

    quickAnswerInFlight.add(meeting.id);
    void generateAndStoreQuickAnswer({
      meeting,
      user,
      question,
      autoTriggered: true,
    })
      .catch((err) => {
        logger.warn(
          'QuickAnswer',
          `Auto-answer failed for meeting=${meeting.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        quickAnswerInFlight.delete(meeting.id);
        const queued = pendingQuickAnswer.get(meeting.id);
        if (queued) {
          pendingQuickAnswer.delete(meeting.id);
          if (queued.meeting.status === 'active' || queued.meeting.status === 'created') {
            triggerAutoQuickAnswer(queued.meeting, queued.user, queued.question);
          }
        }
      });
  }

  async function generateAndStoreQuickAnswer(params: {
    meeting: MeetingSession;
    user: UserProfile;
    question?: string;
    style?: QuickAnswerStyle;
    speed?: QuickAnswerSpeed;
    refineAction?: 'shorter' | 'more_detail' | 'regenerate';
    previousAnswer?: string;
    autoTriggered?: boolean;
  }): Promise<QuickAnswerItem> {
    const {
      meeting,
      user,
      refineAction,
      previousAnswer,
      autoTriggered = false,
    } = params;

    const ctx = meeting.sessionContext;
    const style: QuickAnswerStyle = params.style || ctx?.preferredStyle || 'concise';
    const speed: QuickAnswerSpeed = params.speed || ctx?.preferredSpeed || 'fast';

    let question = params.question?.trim() || '';
    if (!question) {
      const latestProspectTurn = [...meeting.transcript]
        .reverse()
        .find((t) => t.speaker !== 'Sales Representative' && t.speaker !== 'AE');
      const fallbackTurn = meeting.transcript[meeting.transcript.length - 1];
      question =
        latestProspectTurn?.text ||
        fallbackTurn?.text ||
        `Summarize how we should position our value for ${meeting.accountName} right now.`;
    }

    const startedAt = Date.now();
    broadcastToMeeting(meeting.id, {
      type: 'quick_answer:generating',
      meetingId: meeting.id,
      question,
      generating: true,
    });

    try {
      // Retrieve top grounded chunks via local Hugging Face BAAI/bge-m3 hybrid RAG
      const ragResults = await store.searchKnowledge(meeting.organisationId, question, 5);
      const chunkMap = new Map<string, KnowledgeChunk>();
      for (const c of store.getState().knowledgeChunks) {
        if (c.organisationId === meeting.organisationId) {
          chunkMap.set(c.id, c);
        }
      }
      const retrievedChunks = ragResults
        .map((r) => chunkMap.get(r.chunkId))
        .filter((c): c is KnowledgeChunk => Boolean(c));

      const lowerQ = question.toLowerCase();
      const orgBattlecards = store
        .getState()
        .battlecards.filter((b) => b.organisationId === meeting.organisationId);
      const relevantBattlecard =
        orgBattlecards.find(
          (b) =>
            lowerQ.includes(b.competitorName.toLowerCase()) ||
            b.aliases.some((a) => lowerQ.includes(a.toLowerCase())),
        ) ||
        orgBattlecards.find(
          (b) => b.competitorName.toLowerCase() === meeting.primaryCompetitor.toLowerCase(),
        );

      const output = await salesAI.generateQuickAnswer({
        meeting,
        question,
        style,
        speed,
        sessionContext: ctx,
        retrievedChunks,
        relevantBattlecard,
        refineAction,
        previousAnswer,
      });

      const docTitleMap = new Map<string, string>();
      for (const c of retrievedChunks) {
        docTitleMap.set(c.docId, c.docTitle);
      }

      const sources = output.citedDocIds.map((docId) => ({
        docId,
        title: docTitleMap.get(docId) || 'Knowledge Base',
      }));

      const item: QuickAnswerItem = {
        id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        meetingId: meeting.id,
        createdAt: formatNowTime(),
        detectedQuestion: question,
        style,
        modelTier: speed,
        modelUsed: output.modelUsed,
        latencyMs: Date.now() - startedAt,
        headline: output.headline,
        spokenAnswer: output.spokenAnswer,
        keyBullets: output.keyBullets,
        codeSnippet: output.codeSnippet,
        codeLanguage: output.codeLanguage,
        followUpQuestion: output.followUpQuestion,
        sources,
        autoTriggered,
      };

      if (!Array.isArray(meeting.quickAnswers)) {
        meeting.quickAnswers = [];
      }
      meeting.quickAnswers.unshift(item);
      if (meeting.quickAnswers.length > 30) {
        meeting.quickAnswers = meeting.quickAnswers.slice(0, 30);
      }

      store.logAudit({
        organisationId: meeting.organisationId,
        actorName: user.name,
        actorRole: user.role,
        action: autoTriggered ? 'copilot.auto_answered' : 'copilot.quick_answered',
        resource: `${meeting.accountName} · ${style}/${speed} (${item.latencyMs}ms)`,
      });
      store.save();

      broadcastToMeeting(meeting.id, {
        type: 'quick_answer:ready',
        meetingId: meeting.id,
        answer: item,
        meeting,
        generating: false,
      });

      return item;
    } catch (err) {
      broadcastToMeeting(meeting.id, {
        type: 'quick_answer:generating',
        meetingId: meeting.id,
        generating: false,
      });
      throw err;
    }
  }

  async function processTranscriptTurn(params: {
    meeting: MeetingSession;
    speaker: SpeakerRole;
    speakerName: string;
    text: string;
    eventId?: string;
    user: UserProfile;
  }) {
    const { meeting, speaker, speakerName, text, eventId, user } = params;

    // Guard deduplication and lifecycle state BEFORE firing concurrent auto-answer
    const isDuplicateEvent = Boolean(eventId && meeting.transcript.some((t) => t.eventId === eventId));
    const canAcceptTurn =
      meeting.status !== 'paused' && meeting.status !== 'completed' && meeting.status !== 'failed';

    // Parakeet-style auto-answer: fire instant fast-model response concurrently when the prospect speaks a question or sales objection
    const isOtherSpeaker = speaker !== 'Sales Representative' && speaker !== 'AE';
    const autoAnswerEnabled = meeting.sessionContext?.autoAnswer !== false;
    if (
      canAcceptTurn &&
      !isDuplicateEvent &&
      isOtherSpeaker &&
      autoAnswerEnabled &&
      detectSpokenQuestionOrPrompt(text, meeting)
    ) {
      triggerAutoQuickAnswer(meeting, user, text);
    }

    const result = await runLiveIntelligencePipeline({
      meeting,
      speaker,
      speakerName,
      text,
      eventId,
      onTranscriptAccepted: (updatedMeeting, analyzing) => {
        broadcastToMeeting(updatedMeeting.id, {
          type: 'meeting:state',
          meeting: updatedMeeting,
          analyzing,
        });
      },
    });

    if (result.deduplicated) {
      return result;
    }

    broadcastToMeeting(meeting.id, {
      type: 'copilot:update',
      meeting,
      newInsights: result.insights,
      evolved: result.evolved,
      analyzing: false,
    });

    return result;
  }

  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          orgId?: string;
          userId?: string;
          meetingId?: string;
          eventId?: string;
          speaker?: SpeakerRole;
          speakerName?: string;
          text?: string;
          sourceTitle?: string;
          insightId?: string;
          rating?: FeedbackRating;
          comment?: string;
          action?: 'apply' | 'dismiss';
          status?: MeetingSession['status'];
          captureConsentConfirmed?: boolean;
        };

        const orgId = msg.orgId || 'org-acme';
        const state = store.getState();
        const user =
          state.users.find((u) => u.id === msg.userId && u.organisationId === orgId) ||
          state.users.find((u) => u.organisationId === orgId) ||
          state.users[0];

        if (msg.type === 'meeting:join' && msg.meetingId) {
          const meeting = state.meetings.find(
            (m) => m.id === msg.meetingId && m.organisationId === orgId,
          );
          clientRooms.set(ws, { meetingId: msg.meetingId, orgId });
          if (meeting) {
            ws.send(JSON.stringify({ type: 'meeting:state', meeting }));
          }
          return;
        }

        if (msg.type === 'transcript:add' && msg.meetingId && msg.text?.trim()) {
          const meeting = state.meetings.find(
            (m) => m.id === msg.meetingId && m.organisationId === orgId,
          );
          if (!meeting) return;

          try {
            await processTranscriptTurn({
              meeting,
              speaker:
                msg.speaker === 'Sales Representative' || msg.speaker === 'AE'
                  ? 'Sales Representative'
                  : 'Prospect',
              speakerName: msg.speakerName || '',
              text: msg.text,
              eventId: msg.eventId,
              user,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'AI analysis failed';
            broadcastToMeeting(meeting.id, {
              type: 'copilot:error',
              meetingId: meeting.id,
              error: message,
              analyzing: false,
            });
          }
          return;
        }

        if (msg.type === 'scratchpad:add' && msg.meetingId && msg.text?.trim()) {
          const meeting = state.meetings.find(
            (m) => m.id === msg.meetingId && m.organisationId === orgId,
          );
          if (!meeting) return;
          meeting.scratchpad.unshift({
            id: `sp-${Date.now()}`,
            text: msg.text.trim(),
            sourceTitle: msg.sourceTitle,
            createdAt: formatNowTime(),
          });
          store.save();
          broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
          return;
        }

        if (msg.type === 'insight:action' && msg.meetingId && msg.insightId && msg.action) {
          const meeting = state.meetings.find(
            (m) => m.id === msg.meetingId && m.organisationId === orgId,
          );
          if (!meeting) return;
          const insight = meeting.insights.find((ins) => ins.id === msg.insightId);
          if (!insight) return;
          if (msg.action === 'apply') {
            insight.applied = true;
            insight.feedback = {
              rating: 'used',
              userId: user.id,
              userName: user.name,
              createdAt: new Date().toISOString(),
            };
          }
          if (msg.action === 'dismiss') {
            insight.dismissed = true;
          }
          store.save();
          broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
          return;
        }

        if (msg.type === 'insight:feedback' && msg.meetingId && msg.insightId && msg.rating) {
          const meeting = state.meetings.find(
            (m) => m.id === msg.meetingId && m.organisationId === orgId,
          );
          if (!meeting) return;
          const insight = meeting.insights.find((ins) => ins.id === msg.insightId);
          if (!insight) return;
          insight.feedback = {
            rating: msg.rating,
            comment: msg.comment,
            userId: user.id,
            userName: user.name,
            createdAt: new Date().toISOString(),
          };
          if (msg.rating === 'used') insight.applied = true;
          store.save();
          broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
          return;
        }

        if (msg.type === 'meeting:status' && msg.meetingId && msg.status) {
          const meeting = state.meetings.find(
            (m) => m.id === msg.meetingId && m.organisationId === orgId,
          );
          if (!meeting) return;
          // Explicit transition check: completed meetings stay completed unless recreated
          if (meeting.status === 'completed' && msg.status === 'active') {
            ws.send(
              JSON.stringify({
                type: 'copilot:error',
                meetingId: meeting.id,
                error: 'Completed meetings cannot be restarted. Start a new meeting session.',
              }),
            );
            return;
          }
          if (msg.status === 'completed') {
            if (typeof msg.captureConsentConfirmed === 'boolean') {
              meeting.captureConsentConfirmed = msg.captureConsentConfirmed;
            }
            void completeMeetingWithAutoSummary({ meeting, user });
            return;
          }
          meeting.status = msg.status;
          if (msg.status === 'active' && !meeting.startedAt) {
            meeting.startedAt = new Date().toISOString();
          }
          if (typeof msg.captureConsentConfirmed === 'boolean') {
            meeting.captureConsentConfirmed = msg.captureConsentConfirmed;
          }
          store.save();
          broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
          return;
        }

        if (msg.type === 'meeting:reset' && msg.meetingId) {
          const reset = store.resetMeeting(msg.meetingId, orgId);
          if (reset) {
            broadcastToMeeting(reset.id, { type: 'meeting:state', meeting: reset, analyzing: false });
          }
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      clientRooms.delete(ws);
    });
  });

  // Health, Runtime & User Preferences APIs
  app.get('/api/health', (_req, res) => {
    const runtime = getAiRuntimeInfo();
    res.json({
      ok: true,
      aiProvider: runtime.llmProvider,
      ...runtime,
    });
  });

  app.get('/api/preferences', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const key = `${org.id}::${user.email || user.id}`;
    res.json(store.getPreferences(key));
  });

  app.put('/api/preferences', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const key = `${org.id}::${user.email || user.id}`;
    const body = req.body as Partial<CopilotPreferences>;
    const patch: Partial<CopilotPreferences> = {};
    if (body.density === 'compact' || body.density === 'standard' || body.density === 'expanded') {
      patch.density = body.density;
    }
    if (body.hudPosition === 'bottom-right' || body.hudPosition === 'bottom-left') {
      patch.hudPosition = body.hudPosition;
    }
    if (typeof body.hudOpacity === 'number' && Number.isFinite(body.hudOpacity)) {
      patch.hudOpacity = Math.max(60, Math.min(100, Math.round(body.hudOpacity)));
    }
    if (typeof body.showSourcesExpanded === 'boolean') {
      patch.showSourcesExpanded = body.showSourcesExpanded;
    }
    if (typeof body.preferredDisplayId === 'number' || typeof body.preferredDisplayId === 'string') {
      patch.preferredDisplayId = body.preferredDisplayId;
    }
    if (typeof body.onboardingCompleted === 'boolean') {
      patch.onboardingCompleted = body.onboardingCompleted;
    }
    if (typeof body.onboardingDismissed === 'boolean') {
      patch.onboardingDismissed = body.onboardingDismissed;
    }
    if (typeof body.onboardingChecklistDismissed === 'boolean') {
      patch.onboardingChecklistDismissed = body.onboardingChecklistDismissed;
    }
    if (body.onboardingChecklist && typeof body.onboardingChecklist === 'object') {
      const existing = store.getPreferences(key).onboardingChecklist || {};
      patch.onboardingChecklist = {
        ...existing,
        ...(typeof body.onboardingChecklist.goalConfigured === 'boolean'
          ? { goalConfigured: body.onboardingChecklist.goalConfigured }
          : {}),
        ...(typeof body.onboardingChecklist.knowledgeReviewed === 'boolean'
          ? { knowledgeReviewed: body.onboardingChecklist.knowledgeReviewed }
          : {}),
        ...(typeof body.onboardingChecklist.liveSessionTested === 'boolean'
          ? { liveSessionTested: body.onboardingChecklist.liveSessionTested }
          : {}),
        ...(typeof body.onboardingChecklist.stealthHudExplored === 'boolean'
          ? { stealthHudExplored: body.onboardingChecklist.stealthHudExplored }
          : {}),
      };
    }
    const updated = store.updatePreferences(key, patch);
    res.json(updated);
  });

  app.get('/api/org/context', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const state = store.getState();
    res.json({
      organisation: org,
      currentUser: user,
      organisations: state.organisations,
      users: state.users.filter((u) => u.organisationId === org.id),
      auditEvents: state.auditEvents.filter((a) => a.organisationId === org.id),
    });
  });

  app.patch('/api/org/settings', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    if (user.role !== 'Organisation Admin' && user.role !== 'Sales Manager') {
      res.status(403).json({ error: 'Organisation Admin role required to update privacy settings' });
      return;
    }
    const body = req.body as Partial<Organisation['settings']>;
    if (typeof body.retentionDays === 'number') {
      org.settings.retentionDays = Math.max(0, Math.min(365, Math.round(body.retentionDays)));
      store.enforceTranscriptRetention();
    }
    if (typeof body.cooldownSeconds === 'number') {
      org.settings.cooldownSeconds = Math.max(5, Math.min(300, body.cooldownSeconds));
    }
    if (typeof body.abstentionEnabled === 'boolean') {
      org.settings.abstentionEnabled = body.abstentionEnabled;
    }
    if (typeof body.requireCaptureConsent === 'boolean') {
      org.settings.requireCaptureConsent = body.requireCaptureConsent;
    }
    if (Array.isArray(body.qualificationFramework)) {
      org.settings.qualificationFramework = body.qualificationFramework.filter(Boolean);
    }

    store.logAudit({
      organisationId: org.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'organisation.settings_updated',
      resource: `Retention ${org.settings.retentionDays}d · Cooldown ${org.settings.cooldownSeconds}s · Abstention ${org.settings.abstentionEnabled}`,
    });
    store.save();
    res.json(org);
  });

  app.get('/api/dashboard', (req, res) => {
    const { org } = resolveRequestContext(req);
    res.json(store.getDashboardData(org.id));
  });

  // Meetings APIs (strictly tenant-scoped)
  app.get('/api/meetings', (req, res) => {
    const { org } = resolveRequestContext(req);
    res.json(store.getState().meetings.filter((m) => m.organisationId === org.id));
  });

  app.get('/api/meetings/:id', (req, res) => {
    const { org } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.id && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }
    res.json(meeting);
  });

  app.get('/api/meetings/:id/stakeholders', (req, res) => {
    const { org } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.id && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }
    const stakeholders = store.getMeetingStakeholders(meeting.id, org.id);
    res.json({ meetingId: meeting.id, stakeholders });
  });

  app.post('/api/meetings/:id/stakeholders/notes', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.id && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }
    const body = req.body as {
      stakeholderId?: string;
      stakeholderName?: string;
      stakeholderRole?: string;
      text?: string;
    };
    const text = (body.text || '').trim();
    const stakeholderName = (body.stakeholderName || '').trim();
    if (!stakeholderName || !text) {
      res.status(400).json({ error: 'stakeholderName and note text are required' });
      return;
    }
    if (text.length > 1500) {
      res.status(400).json({ error: 'Note text must be 1500 characters or fewer' });
      return;
    }

    const stakeholders = store.addStakeholderNote({
      organisationId: org.id,
      meetingId: meeting.id,
      accountName: meeting.accountName,
      meetingTitle: meeting.title,
      stakeholderId: body.stakeholderId,
      stakeholderName,
      stakeholderRole: body.stakeholderRole,
      author: user.name,
      text,
    });

    store.logAudit({
      organisationId: org.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'stakeholder.note_added',
      resource: `${meeting.accountName} / ${stakeholderName}`,
    });

    res.status(201).json({ meetingId: meeting.id, stakeholders });
  });

  // Upload or paste a meeting transcript (.txt, .vtt, .srt, .md, .docx, .pdf) for Groq Deal Strategy & Customer Sentiment Analysis
  app.post('/api/meetings/analyze-transcript', upload.single('file'), async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    try {
      const file = req.file;
      const body = req.body as {
        accountName?: string;
        meetingTitle?: string;
        stage?: string;
        dealValue?: string | number;
        primaryCompetitor?: string;
        transcriptText?: string;
        saveToArchive?: string | boolean;
      };

      let rawText = typeof body.transcriptText === 'string' ? body.transcriptText.trim() : '';
      let fileName: string | undefined;

      if (file && file.buffer && file.buffer.length > 0) {
        fileName = path.basename(file.originalname || 'transcript.txt');
        const ext = path.extname(fileName).toLowerCase().replace('.', '');

        if (ext === 'pdf') {
          rawText = await salesAI.extractPdfText(file.buffer.toString('base64'));
        } else if (ext === 'docx') {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          rawText = result.value.trim();
        } else if (ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'vtt' || ext === 'srt') {
          rawText = file.buffer.toString('utf-8').trim();
        } else {
          res.status(400).json({
            error: 'Unsupported transcript file type. Upload TXT, VTT, SRT, MD, DOCX, or PDF.',
          });
          return;
        }
      }

      if (!rawText || rawText.length < 30) {
        res.status(400).json({
          error: 'Please upload a transcript file or paste at least a few lines of meeting dialogue.',
        });
        return;
      }

      // Normalize WebVTT / SRT subtitle cues into clean speaker dialogue lines
      const cleanedLines = rawText
        .replace(/^\uFEFF/, '')
        .replace(/^WEBVTT[^\n]*\n?/i, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => {
          if (!line) return false;
          if (/^\d+$/.test(line)) return false; // SRT sequence numbers
          if (/^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}/.test(line)) return false; // VTT/SRT timing lines
          return true;
        })
        .map((line) => line.replace(/<\/?v(?:\s+([^>]+))?>/gi, (_m, speaker) => (speaker ? `${speaker}: ` : '')));

      const normalizedTranscript = cleanedLines.join('\n').slice(0, 120_000);
      if (normalizedTranscript.length < 30) {
        res.status(400).json({
          error: 'No readable dialogue found after parsing the uploaded transcript.',
        });
        return;
      }

      const allowedStages: MeetingSession['stage'][] = [
        'Discovery',
        'Technical Validation',
        'Security Review',
        'Commercial Negotiation',
        'Executive Alignment',
      ];
      const stage: MeetingSession['stage'] = allowedStages.includes(
        body.stage as MeetingSession['stage'],
      )
        ? (body.stage as MeetingSession['stage'])
        : 'Discovery';

      const derivedAccount =
        (body.accountName || '').trim() ||
        (fileName ? fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') : 'Uploaded Call Account');
      const derivedTitle =
        (body.meetingTitle || '').trim() || `${derivedAccount} — Transcript Strategy Analysis`;
      const dealValue = Math.max(0, Number(body.dealValue) || 180000);
      const primaryCompetitor = (body.primaryCompetitor || '').trim();

      // Retrieve org-grounded Knowledge Base chunks (local Hugging Face BAAI/bge-m3 embeddings) + Battlecards
      const retrievalQuery = [
        derivedAccount,
        primaryCompetitor,
        normalizedTranscript.slice(0, 1800),
      ]
        .filter(Boolean)
        .join(' ');
      const retrieved = await store.searchKnowledge(org.id, retrievalQuery, 6);
      const retrievedChunks = retrieved
        .map((r) => store.getState().knowledgeChunks.find((c) => c.id === r.chunkId))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));

      const orgBattlecards = store
        .getState()
        .battlecards.filter((b) => b.organisationId === org.id);

      const analysis = await salesAI.analyzeUploadedTranscript({
        accountName: derivedAccount,
        meetingTitle: derivedTitle,
        stage,
        dealValue,
        primaryCompetitor: primaryCompetitor || undefined,
        fileName,
        transcriptText: normalizedTranscript,
        turnCount: cleanedLines.length,
        retrievedChunks,
        battlecards: orgBattlecards,
      });

      const shouldSave =
        (body.saveToArchive === true || body.saveToArchive === 'true') &&
        user.role !== 'Read-only Analyst';

      if (shouldSave) {
        const stakeholdersList =
          analysis.detectedStakeholders.length > 0
            ? analysis.detectedStakeholders
            : ['Customer Stakeholder'];
        const topCompetitor =
          primaryCompetitor || analysis.detectedCompetitors[0] || 'None identified';
        const envRetention = process.env.TRANSCRIPT_RETENTION_DAYS;
        const retentionDays =
          envRetention !== undefined && envRetention !== ''
            ? Math.max(0, Number(envRetention) || 0)
            : Math.max(0, org.settings.retentionDays ?? 0);

        // Parse simple turns for in-session display when retentionDays > 0
        const parsedTurns: TranscriptTurn[] =
          retentionDays === 0
            ? []
            : cleanedLines.slice(0, 80).map((line, idx) => {
                const match = line.match(/^(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*)?([^:]{2,42}):\s+(.+)$/);
                const speakerName = match ? match[2].trim() : 'Participant';
                const text = match ? match[3].trim() : line;
                const isRep =
                  /\b(rep|ae|account executive|you|sales)\b/i.test(speakerName) ||
                  speakerName.toLowerCase().includes(user.name.toLowerCase());
                return {
                  id: `tr-imp-${Date.now()}-${idx}`,
                  speaker: isRep ? 'Sales Representative' : 'Prospect',
                  speakerName,
                  text,
                  timestamp: match?.[1] || `00:${String(Math.min(59, idx)).padStart(2, '0')}`,
                  detectedTags: [],
                  sentimentScore: (analysis.overallSentiment.score - 50) / 50,
                };
              });

        const savedMeeting: MeetingSession = {
          id: `mtg-imp-${Date.now()}`,
          organisationId: org.id,
          title: analysis.meetingTitle,
          accountName: analysis.accountName,
          platform: 'Simulator',
          dealValue: analysis.dealValue,
          stage: analysis.stage,
          status: 'completed',
          captureConsentConfirmed: true,
          aeName: user.name,
          prospectStakeholders: stakeholdersList,
          primaryCompetitor: topCompetitor,
          startedAt: analysis.analyzedAt,
          endedAt: analysis.analyzedAt,
          durationMinutes: Math.max(15, Math.min(90, Math.round(analysis.wordCount / 130))),
          aeTalkRatio: 44,
          prospectTalkRatio: 56,
          sentimentTrend: analysis.sentimentSegments.map((s) => s.score),
          sentimentSegments: analysis.sentimentSegments,
          qualification: org.settings.qualificationFramework.map((field) => ({
            field,
            covered: false,
          })),
          transcript: parsedTurns,
          insights: [],
          signals: analysis.sentimentDrivers.map((d, idx) => ({
            id: `sig-imp-${Date.now()}-${idx}`,
            organisationId: org.id,
            meetingId: '',
            signalType:
              d.sentiment === 'Constructive'
                ? 'buying_signal'
                : d.sentiment === 'Friction'
                ? 'objection'
                : 'risk',
            category: d.topic,
            certainty: 'high',
            confidenceScore: 86,
            explicitOrInferred: 'explicit',
            evidenceExcerpt: d.excerpt,
            status: 'active',
            suppressedByCooldown: false,
            createdAt: analysis.analyzedAt,
          })),
          scratchpad: analysis.dealStrategyIdeas.slice(0, 4).map((idea, idx) => ({
            id: `pad-imp-${Date.now()}-${idx}`,
            text: `[${idea.priority} · ${idea.category}] ${idea.title}: ${idea.actionPlan}`,
            sourceTitle: 'AI Deal Strategy',
            createdAt: analysis.analyzedAt.slice(0, 10),
          })),
          suppressedDuplicatesCount: 0,
          summaryStatus: 'ready',
          executiveSummary: {
            keyDecisions:
              analysis.keyDecisions.length > 0
                ? analysis.keyDecisions
                : analysis.dealStrategyIdeas.slice(0, 3).map((i) => i.title),
            facts: [
              analysis.overallSentiment.summary,
              ...analysis.buyingSignals.slice(0, 3),
            ],
            interpretations: analysis.dealStrategyIdeas
              .slice(0, 4)
              .map((i) => `${i.title}: ${i.rationale}`),
            nextSteps: analysis.nextSteps,
            followUpEmail: `Hi ${stakeholdersList[0]?.split('(')[0].trim() || 'team'},\n\nThank you for the conversation today regarding ${analysis.accountName}.\n\nKey Takeaways & Next Steps:\n${analysis.nextSteps.map((s) => `- ${s}`).join('\n')}\n\nBest regards,\n${user.name}`,
            autoGenerated: true,
            chunkCount: analysis.sentimentSegments.length,
            generatedAt: analysis.analyzedAt,
          },
        };

        savedMeeting.signals.forEach((s) => {
          s.meetingId = savedMeeting.id;
        });

        store.getState().meetings.unshift(savedMeeting);
        store.ensureStakeholdersRegistered({
          organisationId: org.id,
          accountName: savedMeeting.accountName,
          stakeholderLabels: savedMeeting.prospectStakeholders,
        });
        analysis.savedMeetingId = savedMeeting.id;
      }

      store.logAudit({
        organisationId: org.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'meeting.transcript_analyzed',
        resource: `${analysis.accountName} (${fileName || 'pasted transcript'})`,
      });
      store.save();

      res.status(200).json(analysis);
    } catch (err) {
      logger.error(
        'transcript.analyze',
        err instanceof Error ? err.message : String(err),
      );
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Unable to analyze transcript right now. Please try again.',
      });
    }
  });

  app.post('/api/meetings', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const body = req.body as {
      title?: string;
      accountName?: string;
      platform?: MeetingSession['platform'];
      dealValue?: number;
      stage?: MeetingSession['stage'];
      primaryCompetitor?: string;
      stakeholders?: string[];
      captureConsentConfirmed?: boolean;
    };
    if (!body.accountName?.trim()) {
      res.status(400).json({ error: 'Account name is required' });
      return;
    }
    const created: MeetingSession = {
      id: `mtg-${Date.now()}`,
      organisationId: org.id,
      title: body.title?.trim() || `${body.accountName.trim()} — Sales Conversation`,
      accountName: body.accountName.trim(),
      platform: body.platform || 'Simulator',
      dealValue: Number(body.dealValue) || 180000,
      stage: body.stage || 'Discovery',
      status: body.captureConsentConfirmed ? 'active' : 'created',
      captureConsentConfirmed: Boolean(body.captureConsentConfirmed),
      aeName: user.name,
      prospectStakeholders:
        body.stakeholders && body.stakeholders.length > 0
          ? body.stakeholders
          : ['VP Engineering (Prospect)'],
      primaryCompetitor: body.primaryCompetitor?.trim() || 'ApexCloud',
      startedAt: new Date().toISOString(),
      durationMinutes: 1,
      aeTalkRatio: 0,
      prospectTalkRatio: 0,
      sentimentTrend: [65],
      qualification: org.settings.qualificationFramework.map((field) => ({
        field,
        covered: false,
      })),
      transcript: [],
      insights: [],
      signals: [],
      scratchpad: [],
      suppressedDuplicatesCount: 0,
    };
    store.getState().meetings.unshift(created);
    store.ensureStakeholdersRegistered({
      organisationId: org.id,
      accountName: created.accountName,
      stakeholderLabels: created.prospectStakeholders,
    });
    store.logAudit({
      organisationId: org.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'meeting.created',
      resource: `${created.accountName} (${created.platform})`,
    });
    store.save();
    res.status(201).json(created);
  });

  app.post('/api/meetings/:id/reset', (req, res) => {
    const { org } = resolveRequestContext(req);
    const reset = store.resetMeeting(req.params.id, org.id);
    if (!reset) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }
    broadcastToMeeting(reset.id, { type: 'meeting:state', meeting: reset, analyzing: false });
    res.json(reset);
  });

  app.post('/api/meetings/:id/complete', async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.id && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }
    await completeMeetingWithAutoSummary({ meeting, user });
    res.json(meeting);
  });

  // Parakeet-style Live Quick Answer endpoint (Groq + local BAAI/bge-m3 RAG)
  app.post('/api/meetings/:id/quick-answer', async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.id && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }
    const body = (req.body || {}) as {
      question?: string;
      style?: QuickAnswerStyle;
      speed?: QuickAnswerSpeed;
      refineAction?: 'shorter' | 'more_detail' | 'regenerate';
      previousAnswer?: string;
    };

    const allowedStyles: QuickAnswerStyle[] = ['concise', 'detailed', 'star', 'technical'];
    const style: QuickAnswerStyle = allowedStyles.includes(body.style as QuickAnswerStyle)
      ? (body.style as QuickAnswerStyle)
      : meeting.sessionContext?.preferredStyle || 'concise';
    const speed: QuickAnswerSpeed =
      body.speed === 'deep' || body.speed === 'fast'
        ? body.speed
        : meeting.sessionContext?.preferredSpeed || 'fast';

    try {
      const answer = await generateAndStoreQuickAnswer({
        meeting,
        user,
        question: body.question,
        style,
        speed,
        refineAction: body.refineAction,
        previousAnswer: body.previousAnswer,
        autoTriggered: false,
      });
      res.json({ answer, meeting });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Quick answer generation failed';
      res.status(500).json({ error: message });
    }
  });

  // Update per-session Parakeet context (mode, resume/background, custom instructions, auto-answer)
  app.post('/api/meetings/:id/context', (req, res) => {
    const { org } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.id && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }
    const body = (req.body || {}) as Partial<SessionContextConfig>;
    const allowedModes: CopilotSessionMode[] = [
      'sales_call',
      'technical_interview',
      'behavioral_interview',
      'executive_briefing',
    ];
    const allowedStyles: QuickAnswerStyle[] = ['concise', 'detailed', 'star', 'technical'];

    const prev: SessionContextConfig = meeting.sessionContext || {
      mode: 'sales_call',
      autoAnswer: true,
      preferredStyle: 'concise',
      preferredSpeed: 'fast',
    };

    meeting.sessionContext = {
      mode: allowedModes.includes(body.mode as CopilotSessionMode)
        ? (body.mode as CopilotSessionMode)
        : prev.mode,
      autoAnswer: typeof body.autoAnswer === 'boolean' ? body.autoAnswer : prev.autoAnswer,
      preferredStyle: allowedStyles.includes(body.preferredStyle as QuickAnswerStyle)
        ? (body.preferredStyle as QuickAnswerStyle)
        : prev.preferredStyle,
      preferredSpeed:
        body.preferredSpeed === 'fast' || body.preferredSpeed === 'deep'
          ? body.preferredSpeed
          : prev.preferredSpeed,
      userBackground:
        typeof body.userBackground === 'string' ? body.userBackground.slice(0, 8000) : prev.userBackground,
      customInstructions:
        typeof body.customInstructions === 'string'
          ? body.customInstructions.slice(0, 2000)
          : prev.customInstructions,
    };

    store.save();
    broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
    res.json(meeting);
  });

  app.post('/api/meetings/:id/summary', async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.id && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    meeting.summaryStatus = 'generating';
    meeting.summaryError = undefined;
    broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
    try {
      const generated = await salesAI.generateMeetingSummary(meeting);
      meeting.executiveSummary = {
        ...generated,
        autoGenerated: false,
        generatedAt: new Date().toISOString(),
      };
      meeting.summaryStatus = 'ready';
      meeting.summaryError = undefined;
      store.logAudit({
        organisationId: org.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'meeting.summary_generated',
        resource: `${meeting.accountName} (${generated.keyDecisions.length} decisions from ${generated.chunkCount} chunk(s))`,
      });
      store.save();
      broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
      res.json(meeting.executiveSummary);
    } catch (err) {
      meeting.summaryStatus = 'failed';
      meeting.summaryError =
        err instanceof Error ? err.message : 'Failed to generate meeting summary';
      store.save();
      broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
      res.status(500).json({
        error: meeting.summaryError,
      });
    }
  });

  app.post('/api/recommendations/:id/feedback', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const { rating, comment } = req.body as { rating?: FeedbackRating; comment?: string };
    if (!rating) {
      res.status(400).json({ error: 'Feedback rating is required' });
      return;
    }
    const orgMeetings = store.getState().meetings.filter((m) => m.organisationId === org.id);
    for (const meeting of orgMeetings) {
      const insight = meeting.insights.find((i) => i.id === req.params.id);
      if (insight) {
        insight.feedback = {
          rating,
          comment,
          userId: user.id,
          userName: user.name,
          createdAt: new Date().toISOString(),
        };
        if (rating === 'used') insight.applied = true;
        store.save();
        broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
        res.json(insight);
        return;
      }
    }
    res.status(404).json({ error: 'Recommendation not found in organisation' });
  });

  // Knowledge Base APIs (tenant-scoped + PDF/DOCX/PPTX/MD/TXT)
  app.get('/api/knowledge', (req, res) => {
    const { org } = resolveRequestContext(req);
    res.json(store.getState().knowledgeDocs.filter((d) => d.organisationId === org.id));
  });

  app.get('/api/knowledge/:id/chunks', (req, res) => {
    const { org } = resolveRequestContext(req);
    const doc = store
      .getState()
      .knowledgeDocs.find((d) => d.id === req.params.id && d.organisationId === org.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found in organisation' });
      return;
    }
    const chunks = store
      .getState()
      .knowledgeChunks.filter((c) => c.docId === doc.id && c.organisationId === org.id);
    res.json({ doc, chunks });
  });

  app.post('/api/knowledge/upload', upload.single('file'), async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    if (user.role === 'Read-only Analyst') {
      res.status(403).json({ error: 'Read-only users cannot upload documents' });
      return;
    }

    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const title = (req.body.title as string)?.trim() || file.originalname.replace(/\.[^.]+$/, '');
      const category = (req.body.category as KnowledgeCategory) || 'Product Documentation';
      const version = (req.body.version as string)?.trim() || 'v1.0';
      const reviewDate = (req.body.reviewDate as string)?.trim() || '2027-02-01';
      const validUntil = (req.body.validUntil as string)?.trim() || reviewDate;
      const rawApproval = (req.body.approvalStatus as string)?.trim() || 'approved';
      const approvalStatus: KnowledgeApprovalStatus =
        rawApproval === 'draft' || rawApproval === 'expired' || rawApproval === 'rejected'
          ? rawApproval
          : 'approved';
      const rawSensitivity = (req.body.sensitivity as string)?.trim() || 'internal';
      const sensitivity: KnowledgeSensitivity =
        rawSensitivity === 'public' || rawSensitivity === 'confidential'
          ? rawSensitivity
          : 'internal';
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');

      let extractedText = '';
      let fileType: KnowledgeDoc['fileType'] = 'txt';

      if (ext === 'pdf') {
        fileType = 'pdf';
        extractedText = await salesAI.extractPdfText(file.buffer.toString('base64'));
      } else if (ext === 'docx') {
        fileType = 'docx';
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        extractedText = result.value.trim();
      } else if (ext === 'pptx') {
        fileType = 'pptx';
        extractedText = await extractPptxText(file.buffer);
      } else if (ext === 'html' || ext === 'htm') {
        fileType = 'html';
        extractedText = extractHtmlText(file.buffer.toString('utf-8'));
      } else if (ext === 'md' || ext === 'markdown') {
        fileType = 'md';
        extractedText = file.buffer.toString('utf-8').trim();
      } else if (ext === 'txt') {
        fileType = 'txt';
        extractedText = file.buffer.toString('utf-8').trim();
      } else {
        res.status(400).json({
          error: 'Unsupported file type. Upload PDF, DOCX, PPTX, HTML, MD, or TXT.',
        });
        return;
      }

      if (!extractedText) {
        res.status(400).json({ error: 'Uploaded document contains no extractable text' });
        return;
      }

      // §5.3 SHA-256 deduplication check within organisation
      const checksum = computeSha256(extractedText);
      const duplicate = store
        .getState()
        .knowledgeDocs.find((d) => d.organisationId === org.id && d.checksum === checksum);
      if (duplicate && req.body.allowDuplicate !== 'true') {
        res.status(409).json({
          error: `Identical content already indexed as "${duplicate.title}" (${duplicate.version}).`,
          duplicateDocId: duplicate.id,
        });
        return;
      }

      const embCfg = getEmbeddingConfig();
      const docId = `doc-${Date.now()}`;
      const pieces = chunkTextWithSections(extractedText);
      let vectors: number[][] = [];
      let indexed = false;

      try {
        vectors = await salesAI.embedTexts(
          pieces.map(
            (p) => `${title}${p.headingPath ? ` — ${p.headingPath}` : ''}\n${p.content}`,
          ),
          'document',
        );
        indexed = vectors.length === pieces.length && vectors.every((v) => v.length > 0);
      } catch {
        indexed = false;
      }

      const doc: KnowledgeDoc = {
        id: docId,
        organisationId: org.id,
        title,
        fileName: file.originalname,
        fileType,
        category,
        owner: user.name,
        version,
        reviewDate,
        status: 'indexed',
        approvalStatus,
        validUntil,
        sensitivity,
        checksum,
        ingestionStage: 'indexed',
        embeddingModel: embCfg.model,
        embeddingDimension: vectors[0]?.length || embCfg.expectedDimension,
        summary: extractedText.slice(0, 180).replace(/\s+/g, ' ') + '...',
        wordCount: extractedText.split(/\s+/).filter(Boolean).length,
        chunkCount: pieces.length,
        indexedWithEmbeddings: indexed,
        uploadedAt: new Date().toISOString(),
        contentPreview: extractedText.slice(0, 260),
        sourceMode: 'uploaded_kb',
      };

      store.getState().knowledgeDocs.unshift(doc);
      pieces.forEach((piece, idx) => {
        store.getState().knowledgeChunks.push({
          id: `${docId}-chunk-${idx + 1}`,
          organisationId: org.id,
          docId,
          docTitle: title,
          category,
          sectionTitle: piece.sectionTitle,
          headingPath: piece.headingPath,
          pageNumber: piece.pageNumber,
          tokenCount: piece.tokenCount,
          isAtomicFact: piece.isAtomicFact,
          chunkIndex: idx,
          content: piece.content,
          embedding: vectors[idx],
          embeddingModel: vectors[idx]?.length ? embCfg.model : undefined,
          embeddingDimension: vectors[idx]?.length || undefined,
        });
      });

      store.logAudit({
        organisationId: org.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'knowledge.uploaded',
        resource: `${doc.title} (${doc.fileType.toUpperCase()}, ${doc.chunkCount} chunks, ${doc.approvalStatus})`,
      });
      store.save();

      res.status(201).json(doc);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to process uploaded document',
      });
    }
  });

  app.post('/api/knowledge/text', async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    try {
      const body = req.body as {
        title?: string;
        category?: KnowledgeCategory;
        content?: string;
        version?: string;
        reviewDate?: string;
        validUntil?: string;
        approvalStatus?: KnowledgeApprovalStatus;
        sensitivity?: KnowledgeSensitivity;
        fileType?: 'md' | 'txt' | 'html';
      };
      if (!body.title?.trim() || !body.content?.trim()) {
        res.status(400).json({ error: 'Title and document content are required' });
        return;
      }

      const rawText =
        body.fileType === 'html' ? extractHtmlText(body.content.trim()) : body.content.trim();
      const checksum = computeSha256(rawText);
      const duplicate = store
        .getState()
        .knowledgeDocs.find((d) => d.organisationId === org.id && d.checksum === checksum);
      if (duplicate) {
        res.status(409).json({
          error: `Identical content already indexed as "${duplicate.title}" (${duplicate.version}).`,
          duplicateDocId: duplicate.id,
        });
        return;
      }

      const embCfg = getEmbeddingConfig();
      const docId = `doc-${Date.now()}`;
      const category = body.category || 'Product Documentation';
      const approvalStatus: KnowledgeApprovalStatus = body.approvalStatus || 'approved';
      const sensitivity: KnowledgeSensitivity = body.sensitivity || 'internal';
      const reviewDate = body.reviewDate?.trim() || '2027-02-01';
      const validUntil = body.validUntil?.trim() || reviewDate;

      const pieces = chunkTextWithSections(rawText);
      let vectors: number[][] = [];
      let indexed = false;

      try {
        vectors = await salesAI.embedTexts(
          pieces.map(
            (p) => `${body.title}\n${p.headingPath ? `${p.headingPath}\n` : ''}${p.content}`,
          ),
          'document',
        );
        indexed = vectors.length === pieces.length && vectors.every((v) => v.length > 0);
      } catch {
        indexed = false;
      }

      const doc: KnowledgeDoc = {
        id: docId,
        organisationId: org.id,
        title: body.title.trim(),
        fileName: `${body.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${body.fileType || 'md'}`,
        fileType: body.fileType || 'md',
        category,
        owner: user.name,
        version: body.version?.trim() || 'v1.0',
        reviewDate,
        status: 'indexed',
        approvalStatus,
        validUntil,
        sensitivity,
        checksum,
        ingestionStage: 'indexed',
        embeddingModel: embCfg.model,
        embeddingDimension: vectors[0]?.length || embCfg.expectedDimension,
        summary: rawText.slice(0, 180).replace(/\s+/g, ' ') + '...',
        wordCount: rawText.split(/\s+/).filter(Boolean).length,
        chunkCount: pieces.length,
        indexedWithEmbeddings: indexed,
        uploadedAt: new Date().toISOString(),
        contentPreview: rawText.slice(0, 260),
        sourceMode: 'uploaded_kb',
      };

      store.getState().knowledgeDocs.unshift(doc);
      pieces.forEach((piece, idx) => {
        store.getState().knowledgeChunks.push({
          id: `${docId}-chunk-${idx + 1}`,
          organisationId: org.id,
          docId,
          docTitle: doc.title,
          category,
          sectionTitle: piece.sectionTitle,
          headingPath: piece.headingPath,
          pageNumber: piece.pageNumber,
          tokenCount: piece.tokenCount,
          isAtomicFact: piece.isAtomicFact,
          chunkIndex: idx,
          content: piece.content,
          embedding: vectors[idx],
          embeddingModel: vectors[idx]?.length ? embCfg.model : undefined,
          embeddingDimension: vectors[idx]?.length || undefined,
        });
      });

      store.logAudit({
        organisationId: org.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'knowledge.created',
        resource: `${doc.title} (${doc.version}, ${doc.approvalStatus})`,
      });
      store.save();

      res.status(201).json(doc);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to index document',
      });
    }
  });

  app.patch('/api/knowledge/:id/status', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const { status } = req.body as { status?: 'indexed' | 'archived' };
    const doc = store
      .getState()
      .knowledgeDocs.find((d) => d.id === req.params.id && d.organisationId === org.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (status === 'indexed' || status === 'archived') {
      doc.status = status;
      store.logAudit({
        organisationId: org.id,
        actorName: user.name,
        actorRole: user.role,
        action: status === 'archived' ? 'knowledge.archived' : 'knowledge.restored',
        resource: doc.title,
      });
      store.save();
    }
    res.json(doc);
  });

  app.patch('/api/knowledge/:id/approval', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const { approvalStatus, validUntil } = req.body as {
      approvalStatus?: KnowledgeApprovalStatus;
      validUntil?: string;
    };
    const doc = store
      .getState()
      .knowledgeDocs.find((d) => d.id === req.params.id && d.organisationId === org.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (
      approvalStatus === 'approved' ||
      approvalStatus === 'draft' ||
      approvalStatus === 'expired' ||
      approvalStatus === 'rejected'
    ) {
      doc.approvalStatus = approvalStatus;
    }
    if (typeof validUntil === 'string' && validUntil.trim()) {
      doc.validUntil = validUntil.trim();
    }
    store.logAudit({
      organisationId: org.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'knowledge.approval_updated',
      resource: `${doc.title} -> ${doc.approvalStatus}${doc.validUntil ? ` (valid until ${doc.validUntil})` : ''}`,
    });
    store.save();
    res.json(doc);
  });

  app.post('/api/knowledge/reindex', async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    try {
      const result = await store.ensureChunkEmbeddings({
        forceReindex: true,
        organisationId: org.id,
      });
      store.logAudit({
        organisationId: org.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'knowledge.reindexed',
        resource: `${result.embeddedCount}/${result.totalTargeted} chunks via ${result.embeddingModel} (${result.embeddingDimension}d)`,
      });
      store.save();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to re-index corpus embeddings',
      });
    }
  });

  app.delete('/api/knowledge/:id', (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const state = store.getState();
    const target = state.knowledgeDocs.find(
      (d) => d.id === req.params.id && d.organisationId === org.id,
    );
    if (!target) {
      res.status(404).json({ error: 'Document not found in organisation' });
      return;
    }
    state.knowledgeDocs = state.knowledgeDocs.filter((d) => d.id !== target.id);
    state.knowledgeChunks = state.knowledgeChunks.filter((c) => c.docId !== target.id);
    store.logAudit({
      organisationId: org.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'knowledge.deleted',
      resource: `${target.title} (chunks & embeddings purged)`,
    });
    store.save();
    res.json({ deleted: true });
  });

  app.post('/api/knowledge/search', async (req, res) => {
    const { org } = resolveRequestContext(req);
    const { query, topK, includeDrafts } = req.body as {
      query?: string;
      topK?: number;
      includeDrafts?: boolean;
    };
    if (!query?.trim()) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }
    const results = await store.searchKnowledge(org.id, query.trim(), topK || 5, {
      includeDrafts: Boolean(includeDrafts),
    });
    res.json({ results });
  });

  // Battlecards APIs (tenant-scoped)
  app.get('/api/battlecards', (req, res) => {
    const { org } = resolveRequestContext(req);
    res.json(store.getState().battlecards.filter((b) => b.organisationId === org.id));
  });

  app.post('/api/battlecards/generate', async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const { competitorName } = req.body as { competitorName?: string };
    if (!competitorName?.trim()) {
      res.status(400).json({ error: 'Competitor name is required' });
      return;
    }
    try {
      const relevant = await store.searchKnowledge(org.id, competitorName.trim(), 5);
      const generated = await salesAI.generateBattlecard({
        competitorName: competitorName.trim(),
        contextChunks: relevant.map((r, idx) => ({
          id: r.chunkId,
          organisationId: org.id,
          docId: r.docId,
          docTitle: r.docTitle,
          category: r.category,
          sectionTitle: r.sectionTitle,
          chunkIndex: idx,
          content: r.content,
        })),
      });

      const card: Battlecard = {
        id: `bc-${Date.now()}`,
        organisationId: org.id,
        competitorName: competitorName.trim(),
        aliases: generated.aliases || [],
        tagline: generated.tagline,
        winRatePct: 70,
        dealsTracked: 1,
        avgDiscountPressurePct: 12,
        theirStrengths: generated.theirStrengths,
        theirWeaknesses: generated.theirWeaknesses,
        ourDifferentiators: generated.ourDifferentiators,
        landmineQuestions: generated.landmineQuestions,
        prohibitedClaims: generated.prohibitedClaims || [],
        pricingCounterStrategy: generated.pricingCounterStrategy,
        quickCounters: generated.quickCounters,
        reviewDate: '2027-03-01',
        updatedAt: new Date().toISOString(),
      };
      store.getState().battlecards.unshift(card);
      store.logAudit({
        organisationId: org.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'battlecard.generated',
        resource: card.competitorName,
      });
      store.save();
      res.status(201).json(card);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate battlecard',
      });
    }
  });

  // Live Zoom Bot & Transcript Webhook Integration APIs (Option 2)
  function resolveBaseUrl(req: express.Request): string {
    const envUrl = process.env.APP_URL?.trim();
    if (envUrl && envUrl !== 'MY_APP_URL') {
      return envUrl.replace(/\/+$/, '');
    }
    const proto = (req.header('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    const host = req.header('x-forwarded-host') || req.get('host') || `localhost:${PORT}`;
    return `${proto}://${host}`;
  }

  app.get('/api/integrations/zoom/status', (req, res) => {
    const { org } = resolveRequestContext(req);
    const meetingId = typeof req.query.meetingId === 'string' ? req.query.meetingId : '';
    const meeting = meetingId
      ? store.getState().meetings.find((m) => m.id === meetingId && m.organisationId === org.id)
      : undefined;
    const baseUrl = resolveBaseUrl(req);
    const webhookUrl = meeting
      ? `${baseUrl}/api/integrations/zoom/webhook?meetingId=${encodeURIComponent(meeting.id)}`
      : `${baseUrl}/api/integrations/zoom/webhook`;

    res.json({
      recallConfigured: Boolean(process.env.RECALL_API_KEY?.trim()),
      recallRegion: resolveRecallBaseUrl(process.env.RECALL_REGION),
      webhookSecretConfigured: Boolean(process.env.ZOOM_WEBHOOK_SECRET?.trim()),
      webhookUrl,
      desktopHudUrl: `${baseUrl}/?mode=desktop-hud${
        meeting ? `&meetingId=${encodeURIComponent(meeting.id)}` : ''
      }`,
      zoomLink: meeting?.zoomLink || {
        provider: 'webhook',
        status: 'disconnected',
      },
    });
  });

  app.post('/api/integrations/zoom/bot', async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const { meetingId, meetingUrl, botName } = req.body as {
      meetingId?: string;
      meetingUrl?: string;
      botName?: string;
    };

    if (!meetingId || !meetingUrl?.trim()) {
      res.status(400).json({ error: 'meetingId and Zoom meetingUrl are required' });
      return;
    }

    if (!isValidZoomMeetingUrl(meetingUrl)) {
      res.status(400).json({
        error: 'Please enter a valid Zoom meeting URL (e.g. https://zoom.us/j/1234567890).',
      });
      return;
    }

    const meeting = store
      .getState()
      .meetings.find((m) => m.id === meetingId && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }

    const baseUrl = resolveBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/integrations/zoom/webhook?meetingId=${encodeURIComponent(
      meeting.id,
    )}`;

    try {
      const cleanBotName = botName?.trim() || 'AI Sales Strategist Notetaker';
      const dispatched = await dispatchRecallBot({
        meetingUrl: meetingUrl.trim(),
        botName: cleanBotName,
        webhookUrl,
      });

      meeting.platform = 'Zoom Bot';
      meeting.captureConsentConfirmed = true;
      if (meeting.status === 'created' || meeting.status === 'paused') {
        meeting.status = 'active';
      }
      meeting.zoomLink = {
        provider: 'recall',
        status: 'joining',
        meetingUrl: meetingUrl.trim(),
        botId: dispatched.botId,
        botName: cleanBotName,
        lastWebhookAt: new Date().toISOString(),
        lastEventNote: `Bot dispatched (${dispatched.status})`,
      };
      store.logAudit({
        organisationId: org.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'zoom.bot_dispatched',
        resource: `${meeting.accountName} (${dispatched.botId})`,
      });
      store.save();
      broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
      res.status(201).json({ zoomLink: meeting.zoomLink, webhookUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to dispatch Zoom bot';
      const recallConfigured = Boolean(process.env.RECALL_API_KEY?.trim());
      res.status(recallConfigured ? 502 : 400).json({
        error: message,
        recallConfigured,
        webhookUrl,
      });
    }
  });

  app.post('/api/integrations/zoom/bot/:meetingId/disconnect', async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.meetingId && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }
    if (meeting.zoomLink?.botId) {
      await leaveRecallBot(meeting.zoomLink.botId);
    }
    meeting.zoomLink = {
      ...(meeting.zoomLink || { provider: 'webhook' }),
      status: 'done',
      lastWebhookAt: new Date().toISOString(),
      lastEventNote: 'Disconnected from Zoom call',
    };
    store.logAudit({
      organisationId: org.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'zoom.bot_disconnected',
      resource: meeting.accountName,
    });
    store.save();
    broadcastToMeeting(meeting.id, { type: 'meeting:state', meeting });
    res.json({ zoomLink: meeting.zoomLink });
  });

  function handleZoomWebhookPayload(
    body: Record<string, unknown>,
    queryMeetingId?: string,
    secret?: string,
  ): { statusCode: number; json: Record<string, unknown> } {
    const normalized = normalizeZoomWebhookPayload(body, queryMeetingId, secret);

    if (normalized.kind === 'url_validation') {
      return {
        statusCode: 200,
        json: {
          plainToken: normalized.plainToken,
          encryptedToken: normalized.encryptedToken,
        },
      };
    }

    const state = store.getState();
    const targetMeeting =
      (normalized.meetingId && state.meetings.find((m) => m.id === normalized.meetingId)) ||
      (normalized.botId && state.meetings.find((m) => m.zoomLink?.botId === normalized.botId)) ||
      state.meetings.find((m) => m.status === 'active') ||
      state.meetings[0];

    if (!targetMeeting) {
      return {
        statusCode: 404,
        json: { error: 'No matching meeting session found for webhook event' },
      };
    }

    if (normalized.kind === 'bot_status') {
      targetMeeting.zoomLink = {
        ...(targetMeeting.zoomLink || { provider: normalized.provider }),
        provider: normalized.provider,
        botId: normalized.botId || targetMeeting.zoomLink?.botId,
        status: normalized.statusUpdate || 'in_call',
        lastWebhookAt: new Date().toISOString(),
        lastEventNote: normalized.statusNote,
      };
      store.save();
      broadcastToMeeting(targetMeeting.id, { type: 'meeting:state', meeting: targetMeeting });
      return {
        statusCode: 200,
        json: { accepted: true, kind: 'bot_status', zoomLink: targetMeeting.zoomLink },
      };
    }

    if (normalized.kind !== 'transcript' || !normalized.text) {
      return { statusCode: 200, json: { accepted: true, ignored: true } };
    }

    const classified = classifyZoomSpeaker(
      normalized.speakerName,
      normalized.speakerRole,
      targetMeeting,
    );

    targetMeeting.platform =
      normalized.provider === 'recall'
        ? 'Zoom Bot'
        : normalized.provider === 'zoom_rtms'
        ? 'Zoom RTMS'
        : targetMeeting.platform;
    targetMeeting.captureConsentConfirmed = true;
    if (targetMeeting.status === 'created' || targetMeeting.status === 'paused') {
      targetMeeting.status = 'active';
    }

    targetMeeting.zoomLink = {
      ...(targetMeeting.zoomLink || { provider: normalized.provider }),
      provider: normalized.provider,
      botId: normalized.botId || targetMeeting.zoomLink?.botId,
      status: 'in_call',
      lastWebhookAt: new Date().toISOString(),
      lastSpeaker: classified.speakerName,
      lastEventNote: `Live line from ${classified.speakerName}`,
    };

    const user =
      state.users.find((u) => u.organisationId === targetMeeting.organisationId) || state.users[0];

    // Acknowledge webhook promptly while pushing live turn through the real-time pipeline
    void processTranscriptTurn({
      meeting: targetMeeting,
      speaker: classified.speaker,
      speakerName: classified.speakerName,
      text: normalized.text,
      eventId: normalized.eventId,
      user,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : 'Zoom webhook AI analysis failed';
      broadcastToMeeting(targetMeeting.id, {
        type: 'copilot:error',
        meetingId: targetMeeting.id,
        error: message,
        analyzing: false,
      });
    });

    return {
      statusCode: 202,
      json: {
        accepted: true,
        meetingId: targetMeeting.id,
        speaker: classified.speaker,
        speakerName: classified.speakerName,
      },
    };
  }

  app.post('/api/integrations/zoom/webhook', (req, res) => {
    const rawBody =
      (req as express.Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body || {});
    const secret = process.env.ZOOM_WEBHOOK_SECRET?.trim();

    if (
      !verifyZoomWebhookSignature({
        rawBody,
        headers: req.headers,
        secret,
      })
    ) {
      res.status(401).json({ error: 'Invalid Zoom webhook signature' });
      return;
    }

    const queryMeetingId = typeof req.query.meetingId === 'string' ? req.query.meetingId : undefined;
    const body = (req.body || {}) as Record<string, unknown>;
    const result = handleZoomWebhookPayload(body, queryMeetingId, secret);
    res.status(result.statusCode).json(result.json);
  });

  app.post('/api/integrations/zoom/test-webhook', (req, res) => {
    const { org } = resolveRequestContext(req);
    const { meetingId, speakerName, text } = req.body as {
      meetingId?: string;
      speakerName?: string;
      text?: string;
    };
    const meeting =
      (meetingId &&
        store.getState().meetings.find((m) => m.id === meetingId && m.organisationId === org.id)) ||
      store.getState().meetings.find((m) => m.organisationId === org.id);

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found in organisation' });
      return;
    }

    const utterance =
      text?.trim() ||
      'We currently use BrowserStack and they offered us a renewal discount.';
    const words = utterance.split(/\s+/).map((w) => ({ text: w }));
    const samplePayload: Record<string, unknown> = {
      event: 'transcript.data',
      id: `test-wh-${Date.now()}`,
      meetingId: meeting.id,
      data: {
        bot_id: meeting.zoomLink?.botId || 'recall-webhook-test',
        data: {
          participant: {
            name: speakerName?.trim() || meeting.prospectStakeholders[0] || 'Samira Patel',
            is_host: false,
          },
          is_final: true,
          words,
        },
      },
    };

    const result = handleZoomWebhookPayload(
      samplePayload,
      meeting.id,
      process.env.ZOOM_WEBHOOK_SECRET?.trim(),
    );
    res.status(result.statusCode).json(result.json);
  });

  // Live Browser Mic + Tab/System Audio Transcription Endpoint (No Bot Required)
  app.post('/api/audio/transcribe', upload.single('audio'), async (req, res) => {
    const { org, user } = resolveRequestContext(req);
    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      res.status(400).json({ error: 'Audio chunk is required' });
      return;
    }

    const meetingId = typeof req.body?.meetingId === 'string' ? req.body.meetingId : '';
    const meeting =
      (meetingId &&
        store.getState().meetings.find((m) => m.id === meetingId && m.organisationId === org.id)) ||
      store.getState().meetings.find((m) => m.organisationId === org.id);

    if (!meeting) {
      res.status(404).json({ error: 'Meeting session not found in organisation' });
      return;
    }

    const rawSpeaker = typeof req.body?.speaker === 'string' ? req.body.speaker : 'Prospect';
    const speaker: SpeakerRole =
      rawSpeaker === 'Sales Representative' || rawSpeaker === 'AE'
        ? 'Sales Representative'
        : 'Prospect';
    const speakerName =
      (typeof req.body?.speakerName === 'string' && req.body.speakerName.trim()) ||
      (speaker === 'Sales Representative'
        ? `${meeting.aeName} (You)`
        : meeting.prospectStakeholders[0] || 'Zoom Prospect');

    try {
      const transcribedText = await salesAI.transcribeAudio({
        buffer: file.buffer,
        mimeType: file.mimetype || 'audio/webm',
      });

      if (!transcribedText || transcribedText.replace(/[^\w]/g, '').length < 2) {
        res.json({ transcribed: false, text: '' });
        return;
      }

      meeting.platform = 'Live Mic';
      meeting.captureConsentConfirmed = true;
      if (meeting.status === 'created' || meeting.status === 'paused') {
        meeting.status = 'active';
      }
      store.save();

      // Run intelligence pipeline and broadcast live over WebSocket
      void processTranscriptTurn({
        meeting,
        speaker,
        speakerName,
        text: transcribedText,
        eventId: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        user,
      }).catch((err) => {
        const message = err instanceof Error ? err.message : 'Live audio AI analysis failed';
        broadcastToMeeting(meeting.id, {
          type: 'copilot:error',
          meetingId: meeting.id,
          error: message,
          analyzing: false,
        });
      });

      res.status(202).json({
        transcribed: true,
        text: transcribedText,
        speaker,
        speakerName,
        meetingId: meeting.id,
      });
    } catch (err) {
      if (err instanceof MissingDeepgramKeyError) {
        res.status(503).json({
          error: err.message,
          missingEnvVar: 'DEEPGRAM_API_KEY',
          sttProvider: 'deepgram',
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Audio transcription failed',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Periodic privacy-first transcript retention enforcement (never retain indefinitely)
  const retentionSweep = setInterval(() => {
    store.enforceTranscriptRetention();
  }, 60 * 60 * 1000);
  retentionSweep.unref();

  server.listen(PORT, '0.0.0.0', () => {
    logger.info('Server', `AI Sales Strategist server listening on http://0.0.0.0:${PORT}`);
    store.enforceTranscriptRetention();
    void store.ensureChunkEmbeddings();
  });
}

startServer().catch((err) => {
  logger.error(
    'Startup',
    `Failed to start AI Sales Strategist server: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
