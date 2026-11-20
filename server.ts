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
  FeedbackRating,
  KnowledgeApprovalStatus,
  KnowledgeCategory,
  KnowledgeDoc,
  KnowledgeSensitivity,
  MeetingSession,
  Organisation,
  SpeakerRole,
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

  async function processTranscriptTurn(params: {
    meeting: MeetingSession;
    speaker: SpeakerRole;
    speakerName: string;
    text: string;
    eventId?: string;
    user: UserProfile;
  }) {
    const { meeting, speaker, speakerName, text, eventId } = params;
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
          meeting.status = msg.status;
          if (msg.status === 'active' && !meeting.startedAt) {
            meeting.startedAt = new Date().toISOString();
          }
          if (typeof msg.captureConsentConfirmed === 'boolean') {
            meeting.captureConsentConfirmed = msg.captureConsentConfirmed;
          }
          if (msg.status === 'completed') {
            meeting.endedAt = new Date().toISOString();
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

  app.post('/api/meetings/:id/summary', async (req, res) => {
    const { org } = resolveRequestContext(req);
    const meeting = store
      .getState()
      .meetings.find((m) => m.id === req.params.id && m.organisationId === org.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    try {
      const generated = await salesAI.generateMeetingSummary(meeting);
      meeting.executiveSummary = {
        ...generated,
        generatedAt: new Date().toISOString(),
      };
      store.save();
      res.json(meeting.executiveSummary);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate meeting summary',
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
