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

export type DisplayDensity = 'compact' | 'standard' | 'expanded';

export interface CopilotPreferences {
  density: DisplayDensity;
  hudPosition?: 'bottom-right' | 'bottom-left';
  hudOpacity?: number;
  showSourcesExpanded?: boolean;
  alwaysOnTop?: boolean;
  preferredDisplayId?: number | string;
  privacyMode?: 'private' | 'standard';
  transcriptRetentionDays?: number;
  onboardingCompleted?: boolean;
  onboardingDismissed?: boolean;
  onboardingChecklistDismissed?: boolean;
  onboardingChecklist?: {
    goalConfigured?: boolean;
    knowledgeReviewed?: boolean;
    liveSessionTested?: boolean;
    stealthHudExplored?: boolean;
  };
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  updatedAt?: string;
}

export interface ConversationStateObjection {
  category: ObjectionCategory | string;
  summary: string;
  status: 'active' | 'evolving' | 'resolved';
}

export interface ConversationState {
  currentVendor?: string;
  currentWorkflow?: string;
  confirmedPainPoints: string[];
  possiblePainPoints: string[];
  desiredOutcomes: string[];
  objections: ConversationStateObjection[];
  buyingSignals: string[];
  stakeholders: string[];
  budgetStatus: 'unknown' | 'discussed' | 'confirmed';
  timelineStatus: 'unknown' | 'discussed' | 'confirmed';
  decisionProcessStatus: 'unknown' | 'discussed' | 'confirmed';
  discoveryGaps: string[];
  openQuestions: string[];
  updatedAt: string;
}

export type QuickAnswerStyle = 'concise' | 'detailed' | 'star' | 'technical';
export type QuickAnswerSpeed = 'fast' | 'deep';
export type CopilotSessionMode =
  | 'sales_call'
  | 'technical_interview'
  | 'behavioral_interview'
  | 'executive_briefing';

export interface SessionContextConfig {
  mode: CopilotSessionMode;
  autoAnswer: boolean;
  preferredStyle: QuickAnswerStyle;
  preferredSpeed: QuickAnswerSpeed;
  userBackground?: string;
  customInstructions?: string;
}

export interface QuickAnswerItem {
  id: string;
  meetingId: string;
  createdAt: string;
  detectedQuestion: string;
  style: QuickAnswerStyle;
  modelTier: QuickAnswerSpeed;
  modelUsed: string;
  latencyMs: number;
  headline: string;
  spokenAnswer: string;
  keyBullets: string[];
  codeSnippet?: string;
  codeLanguage?: string;
  followUpQuestion?: string;
  sources: { docId: string; title: string }[];
  autoTriggered: boolean;
}

export interface SentimentTimelineSegment {
  index: number;
  label: string;
  timeRange?: string;
  score: number; // 0-100
  tone: 'Constructive' | 'Neutral' | 'Cautious' | 'Friction';
  turnCount: number;
  topic?: string;
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
  sentimentSegments?: SentimentTimelineSegment[];
  qualification: QualificationItem[];
  conversationState?: ConversationState;
  transcript: TranscriptTurn[];
  insights: SalesInsight[];
  signals: SignalEvent[];
  scratchpad: ScratchpadNote[];
  quickAnswers?: QuickAnswerItem[];
  sessionContext?: SessionContextConfig;
  suppressedDuplicatesCount: number;
  zoomLink?: ZoomLinkState;
  summaryStatus?: 'idle' | 'generating' | 'ready' | 'failed';
  summaryError?: string;
  executiveSummary?: {
    keyDecisions: string[];
    facts: string[];
    interpretations: string[];
    nextSteps: string[];
    followUpEmail: string;
    autoGenerated?: boolean;
    chunkCount?: number;
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

export interface StakeholderNote {
  id: string;
  text: string;
  author: string;
  meetingId?: string;
  meetingTitle?: string;
  createdAt: string;
  source: 'crm_history' | 'meeting_note' | 'live_note';
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
  historicalNotes?: StakeholderNote[];
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
  detectedInCall?: boolean;
  latestTurnId?: string;
  latestTurnExcerpt?: string;
  latestTurnTimestamp?: string;
  latestSentiment?: 'positive' | 'neutral' | 'cautious';
  previousInteractions: StakeholderInteraction[];
  historicalNotes: StakeholderNote[];
}

export type KnowledgeCategory =
  | 'Product Documentation'
  | 'Competitor Battlecards'
  | 'Pricing & Packaging'
  | 'Objection Playbooks'
  | 'Case Studies & ROI'
  | 'Security & Compliance';

export type KnowledgeStatus = 'processing' | 'indexed' | 'archived' | 'failed';
export type KnowledgeApprovalStatus = 'approved' | 'draft' | 'expired' | 'rejected';
export type KnowledgeSensitivity = 'public' | 'internal' | 'confidential' | 'restricted';
export type IngestionStage =
  | 'queued'
  | 'extracting'
  | 'chunking'
  | 'chunked'
  | 'embedding'
  | 'indexed'
  | 'failed'
  | 'needs_review';

export interface KnowledgeChunk {
  id: string;
  organisationId: string;
  docId: string;
  docTitle: string;
  category: KnowledgeCategory;
  sectionTitle?: string;
  headingPath?: string;
  pageNumber?: number;
  tokenCount?: number;
  isAtomicFact?: boolean;
  chunkIndex: number;
  content: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingDimension?: number;
}

export interface KnowledgeDoc {
  id: string;
  organisationId: string;
  title: string;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'pptx' | 'html' | 'md' | 'txt';
  category: KnowledgeCategory;
  owner: string;
  version: string;
  reviewDate: string;
  status: KnowledgeStatus;
  approvalStatus?: KnowledgeApprovalStatus;
  validFrom?: string;
  validUntil?: string;
  sensitivity?: KnowledgeSensitivity;
  checksum?: string;
  ingestionStage?: IngestionStage;
  embeddingModel?: string;
  embeddingDimension?: number;
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
  headingPath?: string;
  pageNumber?: number;
  tokenCount?: number;
  approvalStatus?: KnowledgeApprovalStatus;
  version?: string;
  embeddingModel?: string;
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

export interface DealStrategyIdea {
  id: string;
  title: string;
  priority: 'High' | 'Medium' | 'Low';
  category:
    | 'Competitive'
    | 'Pricing & ROI'
    | 'Stakeholder Alignment'
    | 'Technical De-Risk'
    | 'Closing Motion';
  rationale: string;
  actionPlan: string;
  suggestedTalkTrack: string;
  expectedImpact: string;
}

export interface CustomerSentimentDriver {
  id: string;
  sentiment: 'Constructive' | 'Neutral' | 'Cautious' | 'Friction';
  speaker: string;
  topic: string;
  excerpt: string;
  signalImpact: string;
}

export interface TranscriptAnalysisResult {
  id: string;
  accountName: string;
  meetingTitle: string;
  stage: DealStage;
  dealValue: number;
  analyzedAt: string;
  fileName?: string;
  wordCount: number;
  turnCount: number;
  detectedCompetitors: string[];
  detectedStakeholders: string[];
  overallSentiment: {
    score: number;
    tone: 'Constructive' | 'Neutral' | 'Cautious' | 'Friction';
    summary: string;
    openingScore: number;
    closingScore: number;
    shift: number;
  };
  sentimentSegments: SentimentTimelineSegment[];
  sentimentDrivers: CustomerSentimentDriver[];
  dealStrategyIdeas: DealStrategyIdea[];
  buyingSignals: string[];
  riskFactors: string[];
  keyDecisions: string[];
  nextSteps: string[];
  groundedSources: { docId: string; title: string; category: string }[];
  savedMeetingId?: string;
}

