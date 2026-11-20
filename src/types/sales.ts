export type SpeakerRole = 'Sales Representative' | 'Prospect' | 'AE';

export type UserRole =
  | 'Organisation Admin'
  | 'Knowledge Manager'
  | 'Sales Manager'
  | 'Sales Representative'
  | 'Read-only Analyst';

export interface UserProfile {
  id: string;
  organisationId: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'invited' | 'disabled';
}

export interface Organisation {
  id: string;
  name: string;
  plan: 'Pilot' | 'Growth' | 'Enterprise';
  settings: {
    retentionDays: number;
    cooldownSeconds: number;
    abstentionEnabled: boolean;
    requireCaptureConsent: boolean;
    qualificationFramework: string[]; // e.g., MEDDPICC fields
  };
}

export interface AuditEvent {
  id: string;
  organisationId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  resource: string;
  createdAt: string;
}

export type InsightCategory =
  | 'competitor'
  | 'objection'
  | 'recommendation'
  | 'discovery'
  | 'buying_signal'
  | 'risk'
  | 'technical_answer';

export type ObjectionCategory =
  | 'Price / budget'
  | 'Timing / priority'
  | 'Authority / stakeholder'
  | 'Competition / alternative'
  | 'Trust / credibility'
  | 'Need / fit'
  | 'Status quo'
  | 'Technical / integration'
  | 'Security / compliance'
  | 'Procurement / legal'
  | 'Implementation / migration'
  | 'Unclassified';

export type CertaintyLevel = 'high' | 'medium' | 'low';

export type FeedbackRating =
  | 'helpful'
  | 'used'
  | 'not_relevant'
  | 'incorrect'
  | 'already_handled';

export type MeetingStatus = 'created' | 'active' | 'paused' | 'completed' | 'failed';

export type DealStage =
  | 'Discovery'
  | 'Technical Validation'
  | 'Security Review'
  | 'Commercial Negotiation'
  | 'Executive Alignment';

export interface TranscriptTurn {
  id: string;
  eventId?: string;
  speaker: SpeakerRole;
  speakerName: string;
  text: string;
  timestamp: string;
  startMs?: number;
  detectedTags: string[];
  sentimentScore: number; // -1 to 1
}

export interface SupportingSourceRef {
  documentId: string;
  title: string;
  section?: string;
  excerpt?: string;
  relevanceScore?: number;
  sourceMode?: 'mock_kb' | 'uploaded_kb';
}

export interface RecommendationFeedback {
  rating: FeedbackRating;
  comment?: string;
  userId: string;
  userName: string;
  createdAt: string;
}

export type DetectedSignalStatus = 'active' | 'evolving' | 'resolved' | 'monitoring';

export interface ObjectionContextEntry {
  excerpt: string;
  speakerName: string;
  timestamp: string;
  turnId?: string;
}

export interface SalesInsight {
  id: string;
  organisationId: string;
  meetingId: string;
  accountName: string;
  lifecycleId?: string;
  objectionStatus?: DetectedSignalStatus;
  evolutionCount?: number;
  category: InsightCategory;
  objectionCategory?: ObjectionCategory;
  title: string;
  objectionDetected?: string;
  trigger: {
    transcriptExcerpt: string;
    speaker: SpeakerRole;
    speakerName: string;
    timestamp: string;
  };
  contextHistory?: ObjectionContextEntry[];
  interpretation: string;
  underlyingConcern?: string;
  certainty: CertaintyLevel;
  confidenceScore?: number;
  explicitOrInferred: 'explicit' | 'inferred';
  suggestedAction: string;
  recommendedApproach?: string;
  suggestedResponse?: string;
  discoveryQuestion?: string;
  differentiator?: string;
  competitorName?: string;
  competitorWeaknesses?: string[];
  conversationBasis?: string;
  supportingSources: SupportingSourceRef[];
  limitations: string[];
  abstained: boolean;
  retrievalMode?: 'mock_kb_lexical' | 'hybrid_rag_embeddings';
  rankingScore?: number;
  fingerprint?: string;
  latencyMs?: number;
  createdAt: string;
  updatedAt?: string;
  feedback?: RecommendationFeedback;
  applied?: boolean;
  dismissed?: boolean;
}

export interface SignalEvent {
  id: string;
  organisationId: string;
  meetingId: string;
  lifecycleId?: string;
  turnId?: string;
  signalType: InsightCategory;
  category: string;
  entityName?: string;
  certainty: CertaintyLevel;
  confidenceScore?: number;
  explicitOrInferred: 'explicit' | 'inferred';
  evidenceExcerpt: string;
  excerpts?: ObjectionContextEntry[];
  status?: DetectedSignalStatus;
  suppressedByCooldown: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ScratchpadNote {
  id: string;
  text: string;
  sourceTitle?: string;
  createdAt: string;
}

export interface QualificationItem {
  field: string;
  covered: boolean;
  evidence?: string;
}

export interface ZoomLinkState {
  provider: 'recall' | 'zoom_rtms' | 'webhook';
  status: 'disconnected' | 'joining' | 'in_call' | 'done' | 'error';
  meetingUrl?: string;
  botId?: string;
  botName?: string;
  lastWebhookAt?: string;
  lastSpeaker?: string;
  lastEventNote?: string;
}

export interface MeetingSession {
  id: string;
  organisationId: string;
  title: string;
  accountName: string;
  platform: 'Simulator' | 'Zoom RTMS' | 'Zoom Bot' | 'Live Mic';
  dealValue: number;
  stage: DealStage;
  status: MeetingStatus;
  captureConsentConfirmed: boolean;
  aeName: string;
  prospectStakeholders: string[];
  primaryCompetitor: string;
  startedAt: string;
  endedAt?: string;
  durationMinutes: number;
  aeTalkRatio: number; // 0-100
  prospectTalkRatio: number; // 0-100
  sentimentTrend: number[]; // sparkline values 0-100
  qualification: QualificationItem[];
  transcript: TranscriptTurn[];
  insights: SalesInsight[];
  signals: SignalEvent[];
  scratchpad: ScratchpadNote[];
  suppressedDuplicatesCount: number;
  zoomLink?: ZoomLinkState;
  executiveSummary?: {
    facts: string[];
    interpretations: string[];
    nextSteps: string[];
    followUpEmail: string;
    generatedAt: string;
  };
}

export interface StakeholderInteraction {
  id: string;
  meetingId?: string;
  meetingTitle: string;
  accountName: string;
  date: string;
  channel: string;
  summary: string;
  keyExcerpt?: string;
  sentiment?: 'positive' | 'neutral' | 'cautious';
}

export interface StakeholderProfile {
  id: string;
  organisationId: string;
  name: string;
  role: string;
  accountName: string;
  buyingRole:
    | 'Economic Buyer'
    | 'Technical Evaluator'
    | 'Security Reviewer'
    | 'Champion'
    | 'Executive Sponsor'
    | 'Stakeholder';
  email?: string;
  focusAreas: string[];
  priorInteractions: StakeholderInteraction[];
}

export interface MeetingStakeholderSummary {
  id: string;
  name: string;
  role: string;
  accountName: string;
  buyingRole: StakeholderProfile['buyingRole'];
  email?: string;
  focusAreas: string[];
  totalInteractions: number;
  currentMeetingTurns: number;
  previousInteractions: StakeholderInteraction[];
}

export type KnowledgeCategory =
  | 'Product Documentation'
  | 'Competitor Battlecards'
  | 'Pricing & Packaging'
  | 'Objection Playbooks'
  | 'Case Studies & ROI'
  | 'Security & Compliance';

export type KnowledgeStatus = 'processing' | 'indexed' | 'archived' | 'failed';

export interface KnowledgeChunk {
  id: string;
  organisationId: string;
  docId: string;
  docTitle: string;
  category: KnowledgeCategory;
  sectionTitle?: string;
  chunkIndex: number;
  content: string;
  embedding?: number[];
}

export interface KnowledgeDoc {
  id: string;
  organisationId: string;
  title: string;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'pptx' | 'md' | 'txt';
  category: KnowledgeCategory;
  owner: string;
  version: string;
  reviewDate: string;
  status: KnowledgeStatus;
  summary: string;
  wordCount: number;
  chunkCount: number;
  indexedWithEmbeddings: boolean;
  uploadedAt: string;
  contentPreview: string;
  sourceMode?: 'mock_kb' | 'uploaded_kb';
}

export interface Battlecard {
  id: string;
  organisationId: string;
  competitorName: string;
  aliases: string[];
  tagline: string;
  winRatePct: number;
  dealsTracked: number;
  avgDiscountPressurePct: number;
  theirStrengths: string[];
  theirWeaknesses: string[];
  ourDifferentiators: string[];
  landmineQuestions: string[];
  prohibitedClaims: string[];
  pricingCounterStrategy: string;
  quickCounters: {
    claim: string;
    counter: string;
  }[];
  reviewDate: string;
  updatedAt: string;
}

export interface RagSearchResult {
  chunkId: string;
  docId: string;
  docTitle: string;
  category: KnowledgeCategory;
  sectionTitle?: string;
  content: string;
  score: number;
}

export interface EvaluationMetrics {
  totalTranscriptTurns: number;
  totalSignalsDetected: number;
  recommendationsShown: number;
  helpfulCount: number;
  usedCount: number;
  incorrectCount: number;
  notRelevantCount: number;
  alreadyHandledCount: number;
  dismissedCount: number;
  duplicateSuppressedCount: number;
  helpfulRatePct: number;
  sourceCoveragePct: number;
  abstentionCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface DashboardData {
  organisation: Organisation;
  kpis: {
    activePipelineValue: number;
    activeMeetingsCount: number;
    competitorMentions7d: number;
    objectionsHandledCount: number;
    indexedDocsCount: number;
  };
  evaluation: EvaluationMetrics;
  recentMeetings: MeetingSession[];
  recentInsights: SalesInsight[];
  competitorTelemetry: {
    competitorName: string;
    mentions: number;
    winRatePct: number;
    topObjection: string;
  }[];
}
