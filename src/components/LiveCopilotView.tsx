import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Copy,
  Cpu,
  DollarSign,
  Lightbulb,
  Loader2,
  Mic,
  MonitorSpeaker,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  ThumbsUp,
  TrendingUp,
  Video,
  X,
} from 'lucide-react';
import { CallTimeline, type TimelineMoment } from './CallTimeline';
import { ParakeetCopilotView } from './ParakeetCopilotView';
import { matchesSearchTerms, renderHighlightedText } from './searchHighlight';
import { SentimentTimelineChart } from './SentimentTimelineChart';
import { StakeholderProfileView } from './StakeholderProfileView';
import { ZoomHudOverlay } from './ZoomHudOverlay';
import type { LiveAudioCaptureState } from '../hooks/useLiveAudioCapture';
import { useTranscriptAutoScroll } from '../hooks/useTranscriptAutoScroll';
import type {
  Battlecard,
  DetectedSignalStatus,
  DisplayDensity,
  FeedbackRating,
  InsightCategory,
  MeetingSession,
  QuickAnswerSpeed,
  QuickAnswerStyle,
  SalesInsight,
  SessionContextConfig,
  SignalEvent,
  SpeakerRole,
} from '../types/sales';

interface LiveCopilotViewProps {
  meetings: MeetingSession[];
  selectedMeeting: MeetingSession | null;
  battlecards: Battlecard[];
  apiHeaders: Record<string, string>;
  wsConnected: boolean;
  analyzing: boolean;
  quickAnswering: boolean;
  quickAnswerQuestion: string | null;
  copilotError: string | null;
  onSelectMeeting: (meetingId: string) => void;
  onSendTurn: (speaker: SpeakerRole, speakerName: string, text: string) => void;
  onRequestQuickAnswer: (params: {
    question?: string;
    style: QuickAnswerStyle;
    speed: QuickAnswerSpeed;
    refineAction?: 'shorter' | 'more_detail' | 'regenerate';
    previousAnswer?: string;
  }) => Promise<void>;
  onUpdateSessionContext: (patch: Partial<SessionContextConfig>) => Promise<void>;
  onPushScratchpad: (text: string, sourceTitle?: string) => void;
  onInsightAction: (insightId: string, action: 'apply' | 'dismiss') => void;
  onInsightFeedback: (insightId: string, rating: FeedbackRating) => void;
  onUpdateMeetingStatus: (status: MeetingSession['status'], consent?: boolean) => void;
  onResetMeeting: (meetingId: string) => void;
  onOpenRiskDrawer: () => void;
  onOpenNewMeetingModal: () => void;
  onOpenZoomConnect: () => void;
  onOpenStealthHud: () => void;
  audioState: LiveAudioCaptureState;
  onStopAudioCapture: () => void;
  onCopyText: (text: string, label?: string) => void;
  density: DisplayDensity;
  onChangeDensity: (density: DisplayDensity) => void;
  onRegenerateSummary: (meetingId: string) => void;
}

interface SimScenario {
  id: string;
  label: string;
  turns: { speaker: SpeakerRole; speakerName: string; text: string }[];
}

const SIMULATED_SCENARIOS: SimScenario[] = [
  {
    id: 'scen-lambdatest-demo',
    label: 'Demo: LambdaTest + Evolving Pricing + Integrations (7 turns)',
    turns: [
      {
        speaker: 'Sales Representative',
        speakerName: 'Elena Vance (Sales Rep)',
        text: 'Could you tell me what testing platform you currently use?',
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: 'We currently use LambdaTest.',
      },
      {
        speaker: 'Sales Representative',
        speakerName: 'Elena Vance (Sales Rep)',
        text: 'How has your experience been so far?',
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: "It's reasonably good, but we are exploring alternatives.",
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: 'Your pricing seems significantly higher.',
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: "I'm not sure the additional cost is justified.",
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: 'We also need to check whether your platform supports our existing integrations.',
      },
    ],
  },
  {
    id: 'scen-pricing-abstention',
    label: 'Scenario 2: Enterprise Security & Unverified Capability',
    turns: [
      {
        speaker: 'Prospect',
        speakerName: 'Marcus Chen (VP Engineering)',
        text: 'Look, our CFO is pushing back on the $65,000 base platform fee, and our team wants to know if you support custom Oracle ZFS mainframe cold-tape ingestion natively?',
      },
      {
        speaker: 'Prospect',
        speakerName: 'Priya Nair (Head of InfoSec)',
        text: 'Also, we cannot go live without BYOK customer-managed keys and SOC2 Type II proof.',
      },
    ],
  },
  {
    id: 'scen-resolution-test',
    label: 'Scenario 3: Evolving Objection Resolution Check',
    turns: [
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: 'Your pricing seems high compared to our current tool.',
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: 'LambdaTest is offering us a more competitive price.',
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: "I'm not sure the additional cost is justified.",
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: 'Actually that ROI breakdown makes sense—we are aligned on running the 14-day pilot.',
      },
    ],
  },
  {
    id: 'scen-multi-competitor',
    label: 'Scenario 4: Multi-Competitor Zoom Call (BrowserStack + CI)',
    turns: [
      {
        speaker: 'Sales Representative',
        speakerName: 'Elena Vance (Sales Rep)',
        text: 'What cross-browser grid does your engineering org rely on today?',
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: 'We currently use BrowserStack, and they already gave us an annual renewal quote.',
      },
      {
        speaker: 'Prospect',
        speakerName: 'Samira Patel (VP Quality Engineering)',
        text: 'Our main worry is paying extra per seat when our Playwright suite scales up.',
      },
    ],
  },
];

function signalMeta(type: InsightCategory, category?: string): {
  label: string;
  accentBg: string;
  accentText: string;
  topBorder: string;
  icon: React.ComponentType<{ className?: string }>;
} {
  if (type === 'competitor') {
    return {
      label: 'Competitor Mention',
      accentBg: 'bg-[#FFFBEB]',
      accentText: 'text-[#92400E]',
      topBorder: 'border-t-2 border-t-[#F59E0B]',
      icon: ShieldAlert,
    };
  }
  if (type === 'buying_signal') {
    return {
      label: 'Buying Signal',
      accentBg: 'bg-[#ECFDF5]',
      accentText: 'text-[#065F46]',
      topBorder: 'border-t-2 border-t-[#10B981]',
      icon: TrendingUp,
    };
  }
  if (type === 'risk') {
    return {
      label: 'Hesitation / Deal Risk',
      accentBg: 'bg-[#FFF1F2]',
      accentText: 'text-[#9F1239]',
      topBorder: 'border-t-2 border-t-[#E11D48]',
      icon: AlertTriangle,
    };
  }
  if (type === 'technical_answer') {
    return {
      label: 'Technical Concern',
      accentBg: 'bg-[#EEF2FF]',
      accentText: 'text-[#4338CA]',
      topBorder: 'border-t-2 border-t-[#4F46E5]',
      icon: Sparkles,
    };
  }
  return {
    label: category || 'Objection Detected',
    accentBg: 'bg-[#FFF1F2]',
    accentText: 'text-[#9F1239]',
    topBorder: 'border-t-2 border-t-[#F43F5E]',
    icon: AlertTriangle,
  };
}

function statusDisplay(status?: DetectedSignalStatus, evolutionCount = 1): {
  label: string;
  className: string;
} {
  if (status === 'resolved') {
    return {
      label: 'Resolved',
      className: 'text-[#065F46] bg-[#ECFDF5] border-[#A7F3D0]',
    };
  }
  if (status === 'evolving' || evolutionCount > 1) {
    return {
      label: `Evolving · ${evolutionCount} updates`,
      className: 'text-[#4338CA] bg-[#EEF2FF] border-[#C7D2FE]',
    };
  }
  return {
    label: 'Active',
    className: 'text-[#92400E] bg-[#FFFBEB] border-[#FDE68A]',
  };
}

function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type SignalGroupKey = 'pricing' | 'competitive' | 'technical' | 'buying' | 'risk';

interface SignalGroupMeta {
  key: SignalGroupKey;
  label: string;
  badgeClass: string;
  activeFilterClass: string;
  dotClass: string;
  headerSurfaceClass: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SIGNAL_GROUP_META: Record<SignalGroupKey, SignalGroupMeta> = {
  pricing: {
    key: 'pricing',
    label: 'Pricing',
    badgeClass: 'bg-[#FFF1F2] text-[#9F1239] border-[#FECDD3]',
    activeFilterClass: 'bg-[#E11D48] text-white border-[#E11D48]',
    dotClass: 'bg-[#E11D48]',
    headerSurfaceClass: 'bg-[#FFF1F2]/60 border-[#FECDD3]',
    icon: DollarSign,
  },
  competitive: {
    key: 'competitive',
    label: 'Competitive',
    badgeClass: 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]',
    activeFilterClass: 'bg-[#D97706] text-white border-[#D97706]',
    dotClass: 'bg-[#D97706]',
    headerSurfaceClass: 'bg-[#FFFBEB]/70 border-[#FDE68A]',
    icon: ShieldAlert,
  },
  technical: {
    key: 'technical',
    label: 'Technical',
    badgeClass: 'bg-[#EEF2FF] text-[#3730A3] border-[#C7D2FE]',
    activeFilterClass: 'bg-[#4F46E5] text-white border-[#4F46E5]',
    dotClass: 'bg-[#4F46E5]',
    headerSurfaceClass: 'bg-[#EEF2FF]/65 border-[#C7D2FE]',
    icon: Cpu,
  },
  buying: {
    key: 'buying',
    label: 'Buying Signals',
    badgeClass: 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]',
    activeFilterClass: 'bg-[#059669] text-white border-[#059669]',
    dotClass: 'bg-[#059669]',
    headerSurfaceClass: 'bg-[#ECFDF5]/65 border-[#A7F3D0]',
    icon: TrendingUp,
  },
  risk: {
    key: 'risk',
    label: 'Deal Risk & Fit',
    badgeClass: 'bg-[#FFF7ED] text-[#9A3412] border-[#FED7AA]',
    activeFilterClass: 'bg-[#EA580C] text-white border-[#EA580C]',
    dotClass: 'bg-[#EA580C]',
    headerSurfaceClass: 'bg-[#FFF7ED]/70 border-[#FED7AA]',
    icon: AlertTriangle,
  },
};

function resolveSignalGroupKey(sig: SignalEvent): SignalGroupKey {
  const cat = (sig.category || '').toLowerCase();
  const excerpt = (sig.evidenceExcerpt || '').toLowerCase();

  if (sig.signalType === 'competitor' || cat.includes('compet') || Boolean(sig.entityName)) {
    return 'competitive';
  }
  if (
    cat.includes('price') ||
    cat.includes('budget') ||
    cat.includes('procurement') ||
    cat.includes('cost') ||
    excerpt.includes('pricing') ||
    excerpt.includes('expensive') ||
    excerpt.includes('budget')
  ) {
    return 'pricing';
  }
  if (
    sig.signalType === 'technical_answer' ||
    cat.includes('technical') ||
    cat.includes('integration') ||
    cat.includes('security') ||
    cat.includes('compliance') ||
    cat.includes('implementation') ||
    cat.includes('migration')
  ) {
    return 'technical';
  }
  if (sig.signalType === 'buying_signal' || cat.includes('buying')) {
    return 'buying';
  }
  return 'risk';
}

export const LiveCopilotView: React.FC<LiveCopilotViewProps> = ({
  meetings,
  selectedMeeting,
  battlecards,
  apiHeaders,
  wsConnected,
  analyzing,
  quickAnswering,
  quickAnswerQuestion,
  copilotError,
  onSelectMeeting,
  onSendTurn,
  onRequestQuickAnswer,
  onUpdateSessionContext,
  onPushScratchpad,
  onInsightAction,
  onInsightFeedback,
  onUpdateMeetingStatus,
  onResetMeeting,
  onOpenRiskDrawer,
  onOpenNewMeetingModal,
  onOpenZoomConnect,
  onOpenStealthHud,
  audioState,
  onStopAudioCapture,
  onCopyText,
  density,
  onChangeDensity,
  onRegenerateSummary,
}) => {
  const [speaker, setSpeaker] = React.useState<SpeakerRole>('Prospect');
  const [speakerName, setSpeakerName] = React.useState('');
  const [utterance, setUtterance] = React.useState('');
  const [rightTab, setRightTab] = React.useState<
    'recommendations' | 'deal_state' | 'stakeholders' | 'qualification' | 'notes' | 'recap'
  >('recommendations');
  const [scratchInput, setScratchInput] = React.useState('');
  const [copilotSearchQuery, setCopilotSearchQuery] = React.useState('');
  const [showTimeline, setShowTimeline] = React.useState(true);
  const [viewMode, setViewMode] = React.useState<'parakeet' | 'workspace' | 'zoom'>('parakeet');

  // Simulator controls
  const [selectedScenarioId, setSelectedScenarioId] = React.useState(SIMULATED_SCENARIOS[0].id);
  const [simStep, setSimStep] = React.useState(0);
  const [simPlaying, setSimPlaying] = React.useState(false);

  // Elapsed meeting clock (seconds)
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  const [expandedEvidence, setExpandedEvidence] = React.useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [selectedMomentId, setSelectedMomentId] = React.useState<string | null>(null);
  const [highlightedTurnId, setHighlightedTurnId] = React.useState<string | null>(null);
  const [highlightedInsightId, setHighlightedInsightId] = React.useState<string | null>(null);
  const [signalCategoryFilter, setSignalCategoryFilter] = React.useState<'all' | SignalGroupKey>('all');
  const [collapsedSignalGroups, setCollapsedSignalGroups] = React.useState<Record<string, boolean>>({});

  const turnRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const insightRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  const latestTranscriptTurn =
    selectedMeeting && selectedMeeting.transcript.length > 0
      ? selectedMeeting.transcript[selectedMeeting.transcript.length - 1]
      : null;

  const transcriptScroll = useTranscriptAutoScroll({
    meetingId: selectedMeeting?.id,
    itemCount: selectedMeeting?.transcript.length || 0,
    latestItemKey: latestTranscriptTurn
      ? `${latestTranscriptTurn.id}:${latestTranscriptTurn.text.length}`
      : 'empty',
    active: viewMode === 'workspace',
    suspendAutoScroll: Boolean(copilotSearchQuery.trim()),
  });

  // Reset local UI trackers when switching meetings
  React.useEffect(() => {
    setSelectedMomentId(null);
    setHighlightedTurnId(null);
    setHighlightedInsightId(null);
    setSignalCategoryFilter('all');
    setCollapsedSignalGroups({});
    setCopilotSearchQuery('');
    setSimPlaying(false);
    setSimStep(selectedMeeting?.transcript.length || 0);
    setElapsedSeconds((selectedMeeting?.durationMinutes || 0) * 60);
  }, [selectedMeeting?.id]);

  // Real ticking elapsed timer when meeting is Live ('active')
  React.useEffect(() => {
    if (!selectedMeeting || selectedMeeting.status !== 'active') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [selectedMeeting?.id, selectedMeeting?.status]);

  React.useEffect(() => {
    if (!selectedMeeting) return;
    if (speaker === 'Sales Representative' || speaker === 'AE') {
      setSpeakerName(`${selectedMeeting.aeName} (Sales Rep)`);
    } else {
      setSpeakerName(selectedMeeting.prospectStakeholders[0] || 'Prospect');
    }
  }, [speaker, selectedMeeting?.id]);

  // Sequential Simulated Transcript Engine: waits until prior AI analysis finishes before firing next turn
  React.useEffect(() => {
    if (
      !simPlaying ||
      !selectedMeeting ||
      selectedMeeting.status !== 'active' ||
      analyzing
    ) {
      return;
    }
    const scenario =
      SIMULATED_SCENARIOS.find((s) => s.id === selectedScenarioId) || SIMULATED_SCENARIOS[0];
    if (simStep >= scenario.turns.length) {
      setSimPlaying(false);
      return;
    }

    const delay = simStep === 0 ? 450 : 1700;
    const timer = window.setTimeout(() => {
      const turn = scenario.turns[simStep];
      onSendTurn(turn.speaker, turn.speakerName, turn.text);
      setSimStep((prev) => prev + 1);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [simPlaying, simStep, selectedScenarioId, selectedMeeting?.status, analyzing]);

  if (!selectedMeeting) {
    return (
      <div className="eki-card rounded-lg p-12 text-center space-y-3">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          No Meeting Session Selected
        </h2>
        <p className="text-sm text-slate-500">
          Launch a simulated meeting session to evaluate real-time objection detection and grounded AI sales recommendations.
        </p>
        <button
          type="button"
          onClick={onOpenNewMeetingModal}
          className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Start Simulated Meeting
        </button>
      </div>
    );
  }

  const isLive = selectedMeeting.status === 'active';
  const isPaused = selectedMeeting.status === 'paused';
  const isEnded = selectedMeeting.status === 'completed' || selectedMeeting.status === 'failed';
  const isReady = selectedMeeting.status === 'created';

  const currentScenario =
    SIMULATED_SCENARIOS.find((s) => s.id === selectedScenarioId) || SIMULATED_SCENARIOS[0];
  const activeInsights = selectedMeeting.insights.filter((i) => !i.dismissed);
  const orderedSignals = [...(selectedMeeting.signals || [])].reverse();
  const matchedBattlecard = battlecards.find(
    (b) => b.competitorName.toLowerCase() === selectedMeeting.primaryCompetitor.toLowerCase(),
  );

  const handleStartOrPlay = () => {
    if (isEnded) return;
    if (isReady || isPaused) {
      onUpdateMeetingStatus('active', true);
    }
    if (simStep < currentScenario.turns.length) {
      setSimPlaying(true);
    }
  };

  const handlePause = () => {
    setSimPlaying(false);
    if (isLive) {
      onUpdateMeetingStatus('paused');
    }
  };

  const handleEnd = () => {
    setSimPlaying(false);
    setViewMode('workspace');
    setRightTab('recap');
    onUpdateMeetingStatus('completed');
  };

  const handleReset = () => {
    setSimPlaying(false);
    setSimStep(0);
    setElapsedSeconds(0);
    setSelectedMomentId(null);
    setRightTab('recommendations');
    onResetMeeting(selectedMeeting.id);
  };

  const handleStepTurn = () => {
    if (isEnded || isPaused || analyzing) return;
    if (isReady) {
      onUpdateMeetingStatus('active', true);
    }
    const turn = currentScenario.turns[simStep % currentScenario.turns.length];
    setSimStep((prev) => prev + 1);
    onSendTurn(turn.speaker, turn.speakerName, turn.text);
  };

  const handleSubmitUtterance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!utterance.trim() || isPaused || isEnded || analyzing) return;
    if (isReady) {
      onUpdateMeetingStatus('active', true);
    }
    onSendTurn(speaker, speakerName || speaker, utterance.trim());
    setUtterance('');
  };

  const handleCopy = (id: string, text: string) => {
    onCopyText(text, 'Suggested talking point copied');
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleJumpToTurn = (turnId?: string, excerpt?: string) => {
    let targetId = turnId;
    if (!targetId && excerpt) {
      const needle = excerpt.slice(0, 36).toLowerCase();
      targetId = selectedMeeting.transcript.find((t) =>
        t.text.toLowerCase().includes(needle),
      )?.id;
    }
    if (!targetId) return;
    transcriptScroll.pauseAutoScroll();
    turnRefs.current[targetId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedTurnId(targetId);
    window.setTimeout(() => {
      setHighlightedTurnId((curr) => (curr === targetId ? null : curr));
    }, 2200);
  };

  const handleJumpToInsight = (insightId?: string) => {
    if (!insightId) return;
    setRightTab('recommendations');
    window.requestAnimationFrame(() => {
      insightRefs.current[insightId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setHighlightedInsightId(insightId);
    window.setTimeout(() => {
      setHighlightedInsightId((curr) => (curr === insightId ? null : curr));
    }, 2200);
  };

  const handleSelectMoment = (moment: TimelineMoment | null) => {
    setSelectedMomentId(moment?.id || null);
    if (moment?.turnId) handleJumpToTurn(moment.turnId, moment.excerpt);
    if (moment?.insightId) handleJumpToInsight(moment.insightId);
  };

  const statusBadge = isLive
    ? { label: 'Live', dotClass: 'bg-emerald-500', boxClass: 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]' }
    : isPaused
    ? { label: 'Paused', dotClass: 'bg-amber-500', boxClass: 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]' }
    : isEnded
    ? { label: 'Ended', dotClass: 'bg-slate-400', boxClass: 'bg-slate-100 text-slate-700 border-slate-200' }
    : { label: 'Ready', dotClass: 'bg-[#4F46E5]', boxClass: 'bg-[#EEF2FF] text-[#4338CA] border-[#C7D2FE]' };

  if (viewMode === 'parakeet') {
    return (
      <ParakeetCopilotView
        meetings={meetings}
        selectedMeeting={selectedMeeting}
        apiHeaders={apiHeaders}
        wsConnected={wsConnected}
        quickAnswering={quickAnswering}
        quickAnswerQuestion={quickAnswerQuestion}
        copilotError={copilotError}
        elapsedClock={formatDurationClock(elapsedSeconds)}
        audioState={audioState}
        onSelectMeeting={(id) => {
          setSimPlaying(false);
          onSelectMeeting(id);
        }}
        onSendTurn={(role, name, text) => {
          if (isReady) {
            onUpdateMeetingStatus('active', true);
          }
          onSendTurn(role, name, text);
        }}
        onRequestQuickAnswer={onRequestQuickAnswer}
        onUpdateSessionContext={onUpdateSessionContext}
        onOpenAudioModal={onOpenZoomConnect}
        onStopAudioCapture={onStopAudioCapture}
        onOpenStealthHud={onOpenStealthHud}
        onEndCall={handleEnd}
        onResetMeeting={handleReset}
        onCopyText={onCopyText}
        onPushScratchpad={onPushScratchpad}
        searchQuery={copilotSearchQuery}
        onSearchQueryChange={setCopilotSearchQuery}
        onSwitchWorkspaceMode={(mode) => {
          if (mode === 'parakeet') {
            setViewMode('parakeet');
          } else if (mode === 'recap') {
            setViewMode('workspace');
            setRightTab('recap');
          } else {
            setViewMode('workspace');
            setRightTab('recommendations');
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Meeting Status, Duration & Simulated Transcript Engine Bar */}
      <div className="eki-card rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setViewMode('parakeet')}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[#0F172A] text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            Live Copilot View
          </button>
          <select
            aria-label="Select meeting session"
            value={selectedMeeting.id}
            onChange={(e) => {
              setSimPlaying(false);
              onSelectMeeting(e.target.value);
            }}
            className="eki-input rounded-md px-3 py-1.5 text-[13px] font-semibold text-slate-900 max-w-[280px]"
          >
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.accountName} ({m.primaryCompetitor})
              </option>
            ))}
          </select>

          <div
            className={`px-2.5 py-1 rounded-md border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${statusBadge.boxClass}`}
          >
            <span className={`w-2 h-2 rounded-full ${statusBadge.dotClass}`} />
            <span>{statusBadge.label}</span>
          </div>

          <div
            className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold tabular-nums text-slate-800 border border-slate-200 bg-[#F8FAFC] px-2.5 py-1 rounded-md"
            title="Elapsed meeting duration"
          >
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>{formatDurationClock(elapsedSeconds)}</span>
          </div>

          <span className="hidden xl:inline text-xs text-slate-500 whitespace-nowrap">
            Simulated Transcript Engine · {wsConnected ? 'Socket Synced' : 'Reconnecting'}
          </span>
        </div>

        {/* Play / Pause / Step / End / Reset Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Select simulation script"
            value={selectedScenarioId}
            onChange={(e) => {
              setSelectedScenarioId(e.target.value);
              setSimStep(0);
              setSimPlaying(false);
            }}
            className="eki-input rounded-md px-2.5 py-1.5 text-xs text-slate-800 max-w-[270px]"
          >
            {SIMULATED_SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          {(!isLive || !simPlaying) && !isEnded && (
            <button
              type="button"
              onClick={handleStartOrPlay}
              className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              {isPaused ? 'Resume' : isReady ? 'Start & Play' : 'Play Simulation'}
            </button>
          )}

          {isLive && (
            <button
              type="button"
              onClick={handlePause}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] hover:bg-amber-100 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Pause className="w-3.5 h-3.5" />
              Pause
            </button>
          )}

          <button
            type="button"
            disabled={isPaused || isEnded || analyzing}
            onClick={handleStepTurn}
            className="eki-btn-secondary px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
          >
            <Play className="w-3 h-3 text-[#4F46E5]" />
            Step ({Math.min(simStep, currentScenario.turns.length)}/{currentScenario.turns.length})
          </button>

          {!isEnded && (
            <button
              type="button"
              onClick={handleEnd}
              className="eki-btn-secondary px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap"
            >
              <Square className="w-3 h-3 text-slate-600" />
              End
            </button>
          )}

          <button
            type="button"
            onClick={handleReset}
            className="eki-btn-secondary px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap"
            title="Reset simulated conversation, signals, and recommendations"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
            Reset
          </button>

          <button
            type="button"
            onClick={() => setShowTimeline((s) => !s)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium border whitespace-nowrap ${
              showTimeline
                ? 'bg-[#EEF2FF] text-[#4338CA] border-[#C7D2FE]'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Timeline
          </button>

          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'zoom' ? 'workspace' : 'zoom'))}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap ${
              viewMode === 'zoom'
                ? 'bg-[#0F172A] text-white border-[#0F172A]'
                : 'bg-[#EEF2FF] text-[#4338CA] border-[#C7D2FE] hover:bg-indigo-100/70'
            }`}
            title="Preview compact floating Copilot HUD over a simulated live Zoom call"
          >
            <Video className="w-3.5 h-3.5" />
            {viewMode === 'zoom' ? '3-Panel Workspace' : 'Zoom Call HUD'}
          </button>

          <button
            type="button"
            onClick={onOpenZoomConnect}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap ${
              audioState.capturing
                ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
            }`}
            title="Listen to live Zoom tab/system audio + mic privately (no bot joins)"
          >
            <Mic className={`w-3.5 h-3.5 ${audioState.capturing ? 'text-white' : 'text-emerald-600'}`} />
            <span>{audioState.capturing ? 'Listening Live' : 'Listen Live (No Bot)'}</span>
            {audioState.capturing && (
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenRiskDrawer}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#FFF1F2] text-[#9F1239] border border-[#FECDD3] hover:bg-[#FFE4E6] inline-flex items-center gap-1 whitespace-nowrap"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-[#E11D48]" />
            Battlecard
          </button>
        </div>
      </div>

      {audioState.capturing && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs text-emerald-950">
            <span className="font-semibold inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Bot-Free Live Audio Active
            </span>
            {audioState.tabActive && (
              <div className="flex items-center gap-2">
                <MonitorSpeaker className="w-3.5 h-3.5 text-emerald-700" />
                <span className="text-[11px] font-medium">Zoom Tab (Prospect)</span>
                <div className="w-16 h-1.5 rounded-full bg-emerald-200 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all duration-100"
                    style={{ width: `${audioState.tabLevel}%` }}
                  />
                </div>
              </div>
            )}
            {audioState.micActive && (
              <div className="flex items-center gap-2">
                <Mic className="w-3.5 h-3.5 text-[#4F46E5]" />
                <span className="text-[11px] font-medium">Mic (You)</span>
                <div className="w-16 h-1.5 rounded-full bg-indigo-200 overflow-hidden">
                  <div
                    className="h-full bg-[#4F46E5] transition-all duration-100"
                    style={{ width: `${audioState.micLevel}%` }}
                  />
                </div>
              </div>
            )}
            {audioState.transcribingCount > 0 && (
              <span className="text-[11px] text-emerald-800 inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Transcribing...
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onStopAudioCapture}
            className="px-2.5 py-1 rounded text-xs font-medium bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center gap-1"
          >
            <Square className="w-3 h-3" /> Stop Listening
          </button>
        </div>
      )}

      {viewMode === 'zoom' ? (
        <ZoomHudOverlay
          selectedMeeting={selectedMeeting}
          battlecards={battlecards}
          analyzing={analyzing}
          simPlaying={simPlaying}
          simStep={simStep}
          scenarioTotalTurns={currentScenario.turns.length}
          elapsedClock={formatDurationClock(elapsedSeconds)}
          isLive={isLive}
          isPaused={isPaused}
          isEnded={isEnded}
          isReady={isReady}
          onStartOrPlay={handleStartOrPlay}
          onPause={handlePause}
          onStepTurn={handleStepTurn}
          onEnd={handleEnd}
          onReset={handleReset}
          onSendTurn={onSendTurn}
          onInsightAction={onInsightAction}
          onInsightFeedback={onInsightFeedback}
          onOpenRiskDrawer={onOpenRiskDrawer}
          onCopyText={onCopyText}
          onExitZoomMode={() => setViewMode('workspace')}
        />
      ) : (
      <>
        {showTimeline && (
          <CallTimeline
            meeting={selectedMeeting}
            selectedMomentId={selectedMomentId}
            onSelectMoment={handleSelectMoment}
            onJumpToTurn={handleJumpToTurn}
            onJumpToInsight={handleJumpToInsight}
            onStartSimulation={!isEnded ? handleStartOrPlay : undefined}
          />
        )}

        {(() => {
          const trimmedSearch = copilotSearchQuery.trim();
          const filteredTranscriptTurns = !trimmedSearch
            ? selectedMeeting.transcript
            : selectedMeeting.transcript.filter((turn) =>
                matchesSearchTerms(trimmedSearch, [
                  turn.text,
                  turn.speakerName,
                  turn.speaker,
                  ...(turn.detectedTags || []),
                ]),
              );
          const filteredScratchpadNotes = !trimmedSearch
            ? selectedMeeting.scratchpad
            : selectedMeeting.scratchpad.filter((note) =>
                matchesSearchTerms(trimmedSearch, [note.text, note.sourceTitle, note.createdAt]),
              );

          return (
            <>
              {/* Live Search Bar for Transcript & Pinned Notes */}
              <div className="eki-card rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={copilotSearchQuery}
                    onChange={(e) => setCopilotSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && copilotSearchQuery) {
                        setCopilotSearchQuery('');
                      }
                    }}
                    aria-label="Search live transcript and pinned notes"
                    placeholder="Filter live transcript and pinned notes by keyword, speaker, or tag..."
                    className="eki-input w-full rounded-md pl-8 pr-8 py-1.5 text-xs text-slate-900"
                  />
                  {copilotSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCopilotSearchQuery('')}
                      aria-label="Clear search filter"
                      className="p-0.5 rounded text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                  <span>
                    Transcript: {filteredTranscriptTurns.length}/{selectedMeeting.transcript.length}
                  </span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setRightTab('notes')}
                    className={`hover:text-slate-900 transition-colors ${
                      trimmedSearch && filteredScratchpadNotes.length > 0
                        ? 'text-indigo-700 font-semibold'
                        : ''
                    }`}
                  >
                    Pinned Notes: {filteredScratchpadNotes.length}/{selectedMeeting.scratchpad.length}
                  </button>
                  {trimmedSearch && (
                    <button
                      type="button"
                      onClick={() => setCopilotSearchQuery('')}
                      className="font-sans text-indigo-600 hover:underline font-medium"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

      {/* THREE-SECTION LIVE COPILOT EXPERIENCE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* LEFT SECTION — Live Conversation (4 Cols) */}
        <section className="lg:col-span-4 eki-card rounded-lg flex flex-col lg:h-[calc(100vh-230px)] min-h-[540px]">
          <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-[14px] font-semibold text-slate-900">
                Live Conversation
              </h2>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                Rep {selectedMeeting.aeTalkRatio}% · Prospect {selectedMeeting.prospectTalkRatio}% ·{' '}
                {trimmedSearch
                  ? `${filteredTranscriptTurns.length}/${selectedMeeting.transcript.length} shown`
                  : `${selectedMeeting.transcript.length} turns`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {simPlaying && (
                <span className="text-[11px] font-medium text-[#4338CA] inline-flex items-center gap-1 whitespace-nowrap">
                  <Loader2 className="w-3 h-3 animate-spin" /> Playing
                </span>
              )}
              <button
                type="button"
                onClick={transcriptScroll.toggleAutoScroll}
                aria-pressed={transcriptScroll.autoScrollEnabled}
                title={
                  transcriptScroll.autoScrollEnabled
                    ? 'Auto-scroll is active — click to pause following new turns'
                    : 'Auto-scroll is paused — click to follow latest speaker turns'
                }
                className={`px-2 py-1 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  transcriptScroll.autoScrollEnabled
                    ? 'bg-indigo-50/80 border-indigo-200 text-indigo-700 hover:bg-indigo-100/70'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <ArrowDownToLine className="w-3 h-3" />
                {transcriptScroll.autoScrollEnabled ? 'Auto-scroll' : 'Scroll paused'}
              </button>
            </div>
          </div>

          {isPaused && (
            <div className="px-4 py-2 bg-[#FFFBEB] border-b border-[#FDE68A] text-xs text-[#92400E] flex items-center justify-between gap-2">
              <span>Meeting paused. Click Resume to continue transcript events.</span>
              <button
                type="button"
                onClick={handleStartOrPlay}
                className="font-semibold underline whitespace-nowrap"
              >
                Resume
              </button>
            </div>
          )}

          {/* Live Transcript Stream */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div
              ref={transcriptScroll.containerRef}
              onScroll={transcriptScroll.handleScroll}
              className="flex-1 overflow-y-auto p-3.5 space-y-2.5 bg-[#F8FAFC]/60"
            >
            {selectedMeeting.transcript.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4 space-y-3">
                <p className="text-sm font-semibold text-slate-800">
                  Simulated Transcript Ready
                </p>
                <p className="text-xs text-slate-500 leading-relaxed max-w-xs">
                  Start the 7-turn <strong className="text-slate-700">LambdaTest</strong> evaluation call to watch sequential signal detection, evolving pricing objection context, and grounded recommendations appear automatically.
                </p>
                <button
                  type="button"
                  onClick={handleStartOrPlay}
                  className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" /> Start &amp; Play Simulation
                </button>
              </div>
            ) : filteredTranscriptTurns.length === 0 ? (
              <div className="py-12 px-4 text-center space-y-2.5">
                <Search className="w-5 h-5 text-slate-400 mx-auto" />
                <div className="text-xs font-semibold text-slate-800">
                  No matching transcript turns
                </div>
                <p className="text-xs text-slate-500">
                  No turns matched &ldquo;{trimmedSearch}&rdquo;.
                </p>
                <button
                  type="button"
                  onClick={() => setCopilotSearchQuery('')}
                  className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium"
                >
                  Clear search
                </button>
              </div>
            ) : (
              filteredTranscriptTurns.map((turn, idx) => {
                const isRep = turn.speaker === 'Sales Representative' || turn.speaker === 'AE';
                const isLatest = !trimmedSearch && idx === filteredTranscriptTurns.length - 1;
                const isHighlighted = highlightedTurnId === turn.id;
                const speakerRoleLabel = isRep ? 'Sales Representative' : 'Prospect';

                return (
                  <div
                    key={turn.id}
                    ref={(el) => {
                      turnRefs.current[turn.id] = el;
                    }}
                    className={`rounded-lg p-3 border transition-all duration-150 ${
                      isLatest
                        ? 'bg-white border-[#4F46E5] eki-ai-glow'
                        : isRep
                        ? 'bg-white border-slate-200'
                        : 'bg-white border-slate-300/90'
                    } ${isHighlighted ? 'ring-2 ring-[#4F46E5]' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 text-xs min-w-0">
                        <span
                          className={`font-semibold truncate ${
                            isRep ? 'text-[#4F46E5]' : 'text-slate-900'
                          }`}
                        >
                          {speakerRoleLabel}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[11px] text-slate-500 truncate">
                          {renderHighlightedText(turn.speakerName, trimmedSearch)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isLatest && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#4F46E5]">
                            Latest
                          </span>
                        )}
                        <span className="font-mono text-[11px] tabular-nums text-slate-400">
                          {turn.timestamp}
                        </span>
                      </div>
                    </div>

                    <p className="text-[13px] text-slate-800 leading-relaxed">
                      {renderHighlightedText(turn.text, trimmedSearch)}
                    </p>

                    {turn.detectedTags && turn.detectedTags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium text-slate-500">
                        {turn.detectedTags.map((tag, i) => (
                          <span key={i} className="text-[#4338CA]">
                            #{renderHighlightedText(tag, trimmedSearch)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            </div>

            {transcriptScroll.showJumpToLatest && !trimmedSearch && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3 z-10">
                <button
                  type="button"
                  onClick={transcriptScroll.jumpToLatest}
                  className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-medium shadow-sm transition-colors whitespace-nowrap"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span>Jump to latest</span>
                  {transcriptScroll.unseenCount > 0 && (
                    <span className="font-mono tabular-nums text-indigo-200">
                      · {transcriptScroll.unseenCount} new
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Optional Simulated Turn Injector */}
          <form
            onSubmit={handleSubmitUtterance}
            className="p-3 border-t border-slate-200 bg-white space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center p-0.5 bg-slate-100 rounded-md">
                {(['Prospect', 'Sales Representative'] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setSpeaker(role)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                      speaker === role
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">
                Simulate custom utterance
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                disabled={isPaused || isEnded}
                value={utterance}
                onChange={(e) => setUtterance(e.target.value)}
                placeholder={
                  isPaused || isEnded
                    ? 'Resume or reset meeting to inject turns...'
                    : `Add ${speaker} line (e.g. resolution or objection)...`
                }
                className="eki-input flex-1 rounded-md px-2.5 py-1.5 text-xs text-slate-900 disabled:bg-slate-100"
              />
              <button
                type="submit"
                disabled={!utterance.trim() || analyzing || isPaused || isEnded}
                className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
              >
                <Send className="w-3 h-3" /> Send
              </button>
            </div>
          </form>
        </section>

        {/* CENTRE SECTION — Conversation Intelligence (3 Cols) */}
        <section className="lg:col-span-3 eki-card rounded-lg flex flex-col lg:h-[calc(100vh-230px)] min-h-[540px]">
          <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-[14px] font-semibold text-slate-900">
                Conversation Intelligence
              </h2>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                {orderedSignals.length} signal(s) · {selectedMeeting.suppressedDuplicatesCount} merged
              </div>
            </div>
            <Activity className="w-4 h-4 text-[#4F46E5] shrink-0" />
          </div>

          {(() => {
            const groupedMap = new Map<SignalGroupKey, SignalEvent[]>();
            for (const sig of orderedSignals) {
              const gKey = resolveSignalGroupKey(sig);
              const list = groupedMap.get(gKey) || [];
              list.push(sig);
              groupedMap.set(gKey, list);
            }

            const presentGroups = Array.from(groupedMap.entries()).map(([key, items]) => ({
              meta: SIGNAL_GROUP_META[key],
              items,
            }));

            const visibleGroups =
              signalCategoryFilter === 'all'
                ? presentGroups
                : presentGroups.filter((g) => g.meta.key === signalCategoryFilter);

            return (
              <>
                {orderedSignals.length > 0 && (
                  <div className="px-3 py-2 border-b border-slate-200 bg-white flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSignalCategoryFilter('all')}
                      className={`px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors tabular-nums ${
                        signalCategoryFilter === 'all'
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      All ({orderedSignals.length})
                    </button>
                    {presentGroups.map(({ meta, items }) => {
                      const isActive = signalCategoryFilter === meta.key;
                      const GroupIcon = meta.icon;
                      return (
                        <button
                          key={meta.key}
                          type="button"
                          onClick={() =>
                            setSignalCategoryFilter((curr) =>
                              curr === meta.key ? 'all' : meta.key,
                            )
                          }
                          className={`px-2 py-0.5 rounded border text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors tabular-nums ${
                            isActive
                              ? meta.activeFilterClass
                              : `${meta.badgeClass} hover:opacity-90`
                          }`}
                        >
                          <GroupIcon className="w-3 h-3 shrink-0" />
                          <span>{meta.label}</span>
                          <span className="font-mono text-[10px] opacity-90">({items.length})</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#F8FAFC]/40">
                  {orderedSignals.length === 0 ? (
                    <div className="py-14 px-3 text-center space-y-2">
                      <Activity className="w-5 h-5 text-slate-400 mx-auto" />
                      <div className="text-xs font-semibold text-slate-700">
                        Monitoring Conversation Signals
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Neutral discovery questions produce zero noise. Pricing, Competitive, Technical, Security, and Buying signals group here automatically.
                      </p>
                    </div>
                  ) : (
                    visibleGroups.map(({ meta, items }) => {
                      const GroupIcon = meta.icon;
                      const isCollapsed = Boolean(collapsedSignalGroups[meta.key]);
                      return (
                        <div key={meta.key} className="space-y-2">
                          {/* Category Group Header with Color-Coded Badge */}
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedSignalGroups((prev) => ({
                                ...prev,
                                [meta.key]: !prev[meta.key],
                              }))
                            }
                            className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-white/80 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap ${meta.badgeClass}`}
                              >
                                <GroupIcon className="w-3 h-3 shrink-0" />
                                <span>{meta.label}</span>
                              </span>
                              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                                {items.length} {items.length === 1 ? 'insight' : 'insights'}
                              </span>
                            </div>
                            <span className="text-slate-400 shrink-0">
                              {isCollapsed ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronUp className="w-3.5 h-3.5" />
                              )}
                            </span>
                          </button>

                          {!isCollapsed && (
                            <div className="space-y-2">
                              {items.map((sig: SignalEvent) => {
                                const st = statusDisplay(sig.status, sig.excerpts?.length || 1);
                                const linkedInsight = activeInsights.find(
                                  (ins) => sig.lifecycleId && ins.lifecycleId === sig.lifecycleId,
                                );
                                const excerpts =
                                  sig.excerpts && sig.excerpts.length > 0
                                    ? sig.excerpts
                                    : [
                                        {
                                          excerpt: sig.evidenceExcerpt,
                                          speakerName: 'Prospect',
                                          timestamp: sig.createdAt,
                                          turnId: sig.turnId,
                                        },
                                      ];

                                return (
                                  <button
                                    key={sig.id}
                                    type="button"
                                    onClick={() => {
                                      handleJumpToTurn(sig.turnId, sig.evidenceExcerpt);
                                      if (linkedInsight) handleJumpToInsight(linkedInsight.id);
                                    }}
                                    className="w-full text-left rounded-lg border border-slate-200 bg-white overflow-hidden hover:border-[#4F46E5] transition-colors"
                                  >
                                    <div
                                      className={`px-3 py-1.5 border-b flex items-center justify-between gap-2 ${meta.headerSurfaceClass}`}
                                    >
                                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-900 truncate">
                                        <GroupIcon className="w-3 h-3 shrink-0" />
                                        <span className="truncate">
                                          {sig.entityName || sig.category || meta.label}
                                        </span>
                                      </span>
                                      <span className="font-mono text-[10px] tabular-nums text-slate-600 shrink-0">
                                        {sig.updatedAt || sig.createdAt}
                                      </span>
                                    </div>

                                    <div className="p-2.5 space-y-2">
                                      <div className="flex items-center justify-between gap-2 text-[11px]">
                                        <span
                                          className={`px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${st.className}`}
                                        >
                                          {st.label}
                                        </span>
                                        <span className="font-mono tabular-nums text-slate-500">
                                          {sig.certainty.toUpperCase()} · {sig.confidenceScore || 85}%
                                        </span>
                                      </div>

                                      <div className="space-y-1.5">
                                        {excerpts.map((ex, i) => (
                                          <p
                                            key={i}
                                            className="text-xs text-slate-700 leading-snug border-b last:border-b-0 border-slate-100 pb-1 last:pb-0"
                                          >
                                            &ldquo;{ex.excerpt}&rdquo;
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            );
          })()}
        </section>

        {/* RIGHT SECTION — AI Sales Recommendations (5 Cols) */}
        <section className="lg:col-span-5 eki-card rounded-lg flex flex-col lg:h-[calc(100vh-230px)] min-h-[540px]">
          <div className="px-4 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md overflow-x-auto">
              <button
                type="button"
                onClick={() => setRightTab('recommendations')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  rightTab === 'recommendations'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                AI Tips ({activeInsights.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('deal_state')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  rightTab === 'deal_state'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Deal State
              </button>
              <button
                type="button"
                onClick={() => setRightTab('stakeholders')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  rightTab === 'stakeholders'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Stakeholders
              </button>
              <button
                type="button"
                onClick={() => setRightTab('qualification')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  rightTab === 'qualification'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                MEDDPICC ({selectedMeeting.qualification.filter((q) => q.covered).length}/
                {selectedMeeting.qualification.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('notes')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  rightTab === 'notes'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Notes ({selectedMeeting.scratchpad.length})
              </button>
              {(isEnded ||
                selectedMeeting.summaryStatus === 'generating' ||
                Boolean(selectedMeeting.executiveSummary)) && (
                <button
                  type="button"
                  onClick={() => setRightTab('recap')}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap inline-flex items-center gap-1 ${
                    rightTab === 'recap'
                      ? 'bg-white text-[#4338CA] shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {selectedMeeting.summaryStatus === 'generating' && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  Recap
                  {selectedMeeting.executiveSummary?.keyDecisions?.length
                    ? ` (${selectedMeeting.executiveSummary.keyDecisions.length})`
                    : ''}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {rightTab === 'recommendations' && (
                <div
                  className="flex items-center p-0.5 bg-slate-100 rounded-md border border-slate-200/80"
                  role="group"
                  aria-label="Recommendation display density"
                >
                  {(['compact', 'standard', 'expanded'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onChangeDensity(mode)}
                      className={`px-2 py-0.5 rounded text-[10.5px] font-medium capitalize transition-colors ${
                        density === mode
                          ? 'bg-white text-[#4338CA] shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              )}

              {analyzing && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4F46E5]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Refining...
                </span>
              )}
            </div>
          </div>

          {copilotError && (
            <div className="mx-3.5 mt-3 rounded-md bg-[#FFF1F2] border border-[#FECDD3] px-3 py-2 text-xs text-[#9F1239] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-[#E11D48] shrink-0 mt-0.5" />
              <span>{copilotError}</span>
            </div>
          )}

          {rightTab === 'recommendations' && (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#F8FAFC]/40">
              {activeInsights.length === 0 ? (
                <div className="py-16 px-4 text-center space-y-2">
                  <Sparkles className="w-6 h-6 text-[#4F46E5] mx-auto" />
                  <div className="text-sm font-semibold text-slate-800">
                    Proactive Recommendations Ready
                  </div>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                    Cards appear automatically without prompting when a competitor mention, pricing objection, or technical concern is detected—never on neutral small talk.
                  </p>
                </div>
              ) : (
                activeInsights.map((ins: SalesInsight, idx) => {
                  const meta = signalMeta(ins.category, ins.objectionCategory);
                  const st = statusDisplay(ins.objectionStatus, ins.evolutionCount || 1);
                  const evidenceOpen = Boolean(expandedEvidence[ins.id]);
                  const isHighlighted = highlightedInsightId === ins.id;
                  const isUseful =
                    ins.feedback?.rating === 'helpful' || ins.feedback?.rating === 'used';

                  return (
                    <article
                      key={ins.id}
                      ref={(el) => {
                        insightRefs.current[ins.id] = el as HTMLDivElement | null;
                      }}
                      className={`rounded-lg border border-slate-200 bg-white overflow-hidden transition-all duration-150 ${
                        meta.topBorder
                      } ${idx === 0 ? 'eki-ai-glow' : ''} ${
                        isHighlighted ? 'ring-2 ring-[#4F46E5]' : ''
                      }`}
                    >
                      {/* 1. Objection Detected + Lifecycle Status + Confidence */}
                      <div className={`px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 ${meta.accentBg}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[11px] font-bold uppercase tracking-wide ${meta.accentText}`}>
                            {ins.objectionCategory || meta.label}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${st.className}`}>
                            {st.label}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] tabular-nums text-slate-600 flex items-center gap-1.5 shrink-0">
                          <span>
                            {ins.certainty.toUpperCase()} ({ins.confidenceScore || 85}%)
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{ins.explicitOrInferred}</span>
                        </div>
                      </div>

                      <div className={density === 'compact' ? 'p-3 space-y-2' : 'p-3.5 space-y-2.5'}>
                        {/* Title + Evolving Statement Count */}
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-[14px] font-semibold text-slate-900 leading-snug">
                            {ins.objectionDetected || ins.title}
                          </h3>
                          {ins.evolutionCount && ins.evolutionCount > 1 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4338CA] shrink-0">
                              <RefreshCw className="w-3 h-3" />
                              Updated x{ins.evolutionCount}
                            </span>
                          )}
                        </div>

                        {/* Evolving Trigger Excerpts (Standard & Expanded) */}
                        {density !== 'compact' &&
                          ins.contextHistory &&
                          ins.contextHistory.length > 0 && (
                            <div className="text-[11px] text-slate-500 space-y-0.5">
                              {ins.contextHistory
                                .slice(density === 'expanded' ? 0 : -2)
                                .map((ctx, cIdx) => (
                                  <div key={cIdx} className={density === 'expanded' ? '' : 'truncate'}>
                                    <span className="font-mono text-slate-400 mr-1.5">
                                      {ctx.timestamp}
                                    </span>
                                    &ldquo;{ctx.excerpt}&rdquo;
                                  </div>
                                ))}
                            </div>
                          )}

                        {/* 2. What the prospect may actually be concerned about */}
                        {density !== 'compact' && (
                          <div className="text-xs text-slate-700 leading-relaxed">
                            <span className="font-semibold text-slate-900">
                              Underlying Concern:{' '}
                            </span>
                            {ins.underlyingConcern || ins.interpretation}
                          </div>
                        )}

                        {/* Verified Competitor Weaknesses Strip (when battlecard matched) */}
                        {density !== 'compact' &&
                          ins.competitorName &&
                          ins.competitorWeaknesses &&
                          ins.competitorWeaknesses.length > 0 && (
                            <div className="rounded-md bg-[#FFFBEB] border border-[#FDE68A] p-2.5 space-y-1">
                              <div className="text-[11px] font-semibold text-[#92400E] flex items-center gap-1.5">
                                <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span>{ins.competitorName} Weaknesses (Verified Battlecard)</span>
                              </div>
                              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-950 leading-snug">
                                {ins.competitorWeaknesses
                                  .slice(0, density === 'expanded' ? 3 : 2)
                                  .map((w, wIdx) => (
                                    <li key={wIdx}>{w}</li>
                                  ))}
                              </ul>
                            </div>
                          )}

                        {/* Abstention Notice when KB lacks verified evidence */}
                        {ins.abstained && (
                          <div className="rounded-md bg-[#FFFBEB] border border-[#FDE68A] p-2.5 text-xs text-[#92400E]">
                            <strong className="font-semibold">
                              Insufficient Approved Evidence:{' '}
                            </strong>
                            {ins.limitations[0] ||
                              'Do not guess—confirm with Solutions Engineering after the call.'}
                          </div>
                        )}

                        {/* 3 & 4. Recommended Approach + Suggested Talking Point */}
                        <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-2.5 space-y-1.5">
                          <div className="text-xs text-slate-800 leading-relaxed">
                            <span className="font-semibold text-[#4338CA]">
                              Recommended Approach:{' '}
                            </span>
                            {ins.recommendedApproach || ins.suggestedAction}
                          </div>

                          {ins.suggestedResponse && (
                            <div className="pt-1.5 border-t border-slate-200/80 text-xs text-slate-900 leading-relaxed">
                              <span className="font-semibold text-slate-700">Say: </span>
                              &ldquo;{ins.suggestedResponse}&rdquo;
                            </div>
                          )}

                          {density === 'expanded' && ins.differentiator && (
                            <div className="pt-1.5 border-t border-slate-200/80 text-xs text-slate-700 leading-relaxed">
                              <span className="font-semibold text-emerald-700">Differentiator: </span>
                              {ins.differentiator}
                            </div>
                          )}
                        </div>

                        {/* 5. Contextual Discovery Question */}
                        {density !== 'compact' && ins.discoveryQuestion && (
                          <div className="flex items-start gap-2 text-xs text-slate-800 bg-[#EFF6FF]/60 border border-[#DBEAFE] rounded-md p-2.5">
                            <Lightbulb className="w-3.5 h-3.5 text-[#0284C7] shrink-0 mt-0.5" />
                            <div>
                              <span className="font-semibold text-[#0369A1]">Ask Next: </span>
                              {ins.discoveryQuestion}
                            </div>
                          </div>
                        )}

                        {/* 6 & 7. Supporting Evidence & Retrieval Transparency */}
                        {density !== 'compact' && (
                          <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedEvidence((prev) => ({
                                  ...prev,
                                  [ins.id]: !prev[ins.id],
                                }))
                              }
                              className="inline-flex items-center gap-1 font-medium text-[#4F46E5] hover:underline"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              View Supporting Evidence ({ins.supportingSources.length})
                              {evidenceOpen || density === 'expanded' ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>

                            <span className="font-mono text-[10px] text-slate-500">
                              {ins.retrievalMode === 'hybrid_rag_embeddings'
                                ? 'Hugging Face Hybrid RAG'
                                : 'Tenant Lexical RAG'}
                              {ins.latencyMs ? ` · ${ins.latencyMs}ms` : ''}
                            </span>
                          </div>
                        )}

                        {(evidenceOpen || density === 'expanded') && (
                          <div className="space-y-1.5 pt-1">
                            {ins.supportingSources.length === 0 ? (
                              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                                No matching approved document snippet found in Knowledge Base.
                              </div>
                            ) : (
                              ins.supportingSources.map((src, sIdx) => (
                                <div
                                  key={sIdx}
                                  className="rounded border border-slate-200 bg-slate-50 p-2.5 text-[11px] space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-slate-800">
                                      {src.title}
                                      {src.section ? ` · ${src.section}` : ''}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500 shrink-0">
                                      {src.sourceMode === 'mock_kb' ? 'Mock KB' : 'Uploaded KB'}
                                      {src.relevanceScore ? ` · ${src.relevanceScore}%` : ''}
                                    </span>
                                  </div>
                                  {src.excerpt && (
                                    <p className="text-slate-600 leading-relaxed">{src.excerpt}</p>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}

                        {/* Card Actions: Mark Useful, Copy, Dismiss */}
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onInsightFeedback(ins.id, 'helpful')}
                              className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors inline-flex items-center gap-1 ${
                                isUseful
                                  ? 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <ThumbsUp className="w-3 h-3" />
                              {isUseful ? 'Marked Useful' : 'Useful'}
                            </button>

                            {ins.suggestedResponse && (
                              <button
                                type="button"
                                onClick={() => handleCopy(ins.id, ins.suggestedResponse!)}
                                className="px-2.5 py-1 rounded text-[11px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-1"
                              >
                                {copiedId === ins.id ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-600" /> Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" /> Copy
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => onInsightAction(ins.id, 'dismiss')}
                            className="px-2 py-1 rounded text-[11px] font-medium text-slate-500 hover:text-[#9F1239] hover:bg-[#FFF1F2] inline-flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> Dismiss
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          )}

          {rightTab === 'deal_state' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC]/40">
              <div className="text-xs text-slate-500">
                Structured Conversation State updated continuously from transcript turns and injected into LLM reasoning.
              </div>
              {(() => {
                const cs = selectedMeeting.conversationState;
                if (!cs) {
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 space-y-1.5">
                      <div className="font-semibold text-slate-800">No Conversation State Captured Yet</div>
                      <p>
                        Start the simulation or live audio capture to build structured deal memory (incumbent vendor, confirmed pain points, objections, and discovery gaps).
                      </p>
                    </div>
                  );
                }

                const statusClass = (s: 'unknown' | 'discussed' | 'confirmed') =>
                  s === 'confirmed'
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : s === 'discussed'
                    ? 'text-amber-800 bg-amber-50 border-amber-200'
                    : 'text-slate-500 bg-slate-50 border-slate-200';

                return (
                  <div className="space-y-3">
                    <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Incumbent / Competitor</span>
                        <span className="font-semibold text-slate-900">
                          {cs.currentVendor || selectedMeeting.primaryCompetitor || 'Unidentified'}
                        </span>
                      </div>
                      {cs.currentWorkflow && (
                        <div className="text-[11px] text-slate-600 border-t border-slate-100 pt-2">
                          <span className="font-semibold text-slate-800">Current Workflow: </span>
                          {cs.currentWorkflow}
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
                        <div className={`rounded border px-2 py-1.5 ${statusClass(cs.budgetStatus)}`}>
                          <div className="text-[10px] uppercase tracking-wider opacity-75">Budget</div>
                          <div className="text-xs font-semibold capitalize">{cs.budgetStatus}</div>
                        </div>
                        <div className={`rounded border px-2 py-1.5 ${statusClass(cs.timelineStatus)}`}>
                          <div className="text-[10px] uppercase tracking-wider opacity-75">Timeline</div>
                          <div className="text-xs font-semibold capitalize">{cs.timelineStatus}</div>
                        </div>
                        <div className={`rounded border px-2 py-1.5 ${statusClass(cs.decisionProcessStatus)}`}>
                          <div className="text-[10px] uppercase tracking-wider opacity-75">Decision</div>
                          <div className="text-xs font-semibold capitalize">{cs.decisionProcessStatus}</div>
                        </div>
                      </div>
                    </div>

                    {cs.confirmedPainPoints.length > 0 && (
                      <div className="rounded-md border border-slate-200 bg-white p-3 space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Confirmed Pain Points ({cs.confirmedPainPoints.length})
                        </div>
                        <ul className="list-disc pl-4 space-y-1 text-xs text-slate-800">
                          {cs.confirmedPainPoints.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {cs.objections.length > 0 && (
                      <div className="rounded-md border border-slate-200 bg-white p-3 space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Tracked Objections ({cs.objections.length})
                        </div>
                        <div className="space-y-1.5">
                          {cs.objections.map((o, i) => (
                            <div
                              key={i}
                              className="text-xs rounded border border-slate-200 bg-[#F8FAFC] p-2 space-y-0.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900">{o.category}</span>
                                <span className="font-mono text-[10px] uppercase text-slate-500">
                                  {o.status}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600">{o.summary}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {cs.desiredOutcomes.length > 0 && (
                      <div className="rounded-md border border-slate-200 bg-white p-3 space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                          Desired Outcomes
                        </div>
                        <ul className="list-disc pl-4 space-y-1 text-xs text-slate-800">
                          {cs.desiredOutcomes.map((o, i) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {cs.discoveryGaps.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-[#FFFBEB]/60 p-3 space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
                          Open Discovery Gaps ({cs.discoveryGaps.length})
                        </div>
                        <div className="text-xs text-amber-950 leading-relaxed">
                          {cs.discoveryGaps.join(' · ')}
                        </div>
                      </div>
                    )}

                    {cs.openQuestions.length > 0 && (
                      <div className="rounded-md border border-slate-200 bg-white p-3 space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Prospect Questions Raised
                        </div>
                        <ul className="list-disc pl-4 space-y-1 text-xs text-slate-700">
                          {cs.openQuestions.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {rightTab === 'stakeholders' && (
            <StakeholderProfileView
              meeting={selectedMeeting}
              apiHeaders={apiHeaders}
              onCopyText={onCopyText}
              onJumpToTurn={handleJumpToTurn}
            />
          )}

          {rightTab === 'qualification' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              <div className="text-xs text-slate-500 pb-1">
                MEDDPICC criteria tracked automatically from conversation evidence.
              </div>
              {selectedMeeting.qualification.map((q) => (
                <div
                  key={q.field}
                  className={`rounded-md border p-3 space-y-1 ${
                    q.covered
                      ? 'bg-[#ECFDF5]/50 border-[#A7F3D0]'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">{q.field}</span>
                    <span
                      className={`text-[11px] font-medium ${
                        q.covered ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {q.covered ? 'Covered' : 'Unexplored'}
                    </span>
                  </div>
                  {q.evidence && <p className="text-[11px] text-slate-600">{q.evidence}</p>}
                </div>
              ))}
            </div>
          )}

          {rightTab === 'notes' && (
            <div className="flex-1 flex flex-col p-4 space-y-3 overflow-hidden">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!scratchInput.trim()) return;
                  onPushScratchpad(scratchInput.trim(), 'Rep Note');
                  setScratchInput('');
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={scratchInput}
                  onChange={(e) => setScratchInput(e.target.value)}
                  placeholder="Add follow-up note..."
                  className="eki-input flex-1 rounded-md px-3 py-1.5 text-xs"
                />
                <button
                  type="submit"
                  className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap"
                >
                  Save
                </button>
              </form>

              <div className="flex-1 overflow-y-auto space-y-2">
                {selectedMeeting.scratchpad.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500 space-y-1.5">
                    <ClipboardList className="w-5 h-5 text-slate-400 mx-auto" />
                    <p>Record follow-up commitments here.</p>
                  </div>
                ) : filteredScratchpadNotes.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500 space-y-2">
                    <Search className="w-5 h-5 text-slate-400 mx-auto" />
                    <p>No pinned notes matched &ldquo;{trimmedSearch}&rdquo;.</p>
                    <button
                      type="button"
                      onClick={() => setCopilotSearchQuery('')}
                      className="eki-btn-secondary px-3 py-1 rounded text-xs font-medium"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  filteredScratchpadNotes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-md border border-slate-200 bg-[#F8FAFC] p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700">
                          {renderHighlightedText(note.sourceTitle || 'Call Note', trimmedSearch)}
                        </span>
                        <span className="font-mono tabular-nums">{note.createdAt}</span>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed">
                        {renderHighlightedText(note.text, trimmedSearch)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {rightTab === 'recap' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#F8FAFC]/40">
              {selectedMeeting.summaryStatus === 'generating' ? (
                <div className="rounded-lg border border-[#C7D2FE] bg-[#EEF2FF]/60 p-5 text-center space-y-2">
                  <Loader2 className="w-5 h-5 text-[#4F46E5] animate-spin mx-auto" />
                  <div className="text-xs font-semibold text-slate-900">
                    Auto-Summarizing Meeting Decisions...
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed max-w-xs mx-auto">
                    Synthesizing transcript chunks via Groq into a bulleted recap of key decisions, observed facts, and next steps.
                  </p>
                </div>
              ) : selectedMeeting.summaryStatus === 'failed' ? (
                <div className="rounded-lg border border-[#FECDD3] bg-[#FFF1F2] p-4 space-y-2.5">
                  <div className="flex items-start gap-2 text-xs text-[#9F1239]">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#E11D48]" />
                    <div>
                      <div className="font-semibold">Auto-summary could not be completed</div>
                      <p className="text-[11px] mt-0.5">
                        {selectedMeeting.summaryError || 'LLM synthesis failed.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRegenerateSummary(selectedMeeting.id)}
                    className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry Recap
                  </button>
                </div>
              ) : selectedMeeting.executiveSummary ? (
                (() => {
                  const summary = selectedMeeting.executiveSummary;
                  const decisions = summary.keyDecisions || [];
                  const copyMarkdown = [
                    `# Meeting Recap — ${selectedMeeting.accountName}`,
                    '',
                    '## Key Decisions',
                    ...(decisions.length > 0
                      ? decisions.map((d) => `- ${d}`)
                      : ['- No formal decisions recorded.']),
                    '',
                    '## Agreed Next Steps',
                    ...summary.nextSteps.map((s, idx) => `${idx + 1}. ${s}`),
                  ].join('\n');

                  return (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-900">
                            {summary.autoGenerated ? 'Auto-Generated Meeting Recap' : 'Meeting Decisions Recap'}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {summary.chunkCount
                              ? `${summary.chunkCount} transcript chunk${summary.chunkCount === 1 ? '' : 's'} synthesized`
                              : 'Synthesized from session state'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onCopyText(copyMarkdown, 'Decisions recap copied')}
                            className="eki-btn-secondary px-2.5 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" /> Copy Recap
                          </button>
                          <button
                            type="button"
                            onClick={() => onRegenerateSummary(selectedMeeting.id)}
                            className="eki-btn-secondary px-2 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1"
                            title="Regenerate recap"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Key Decisions Bulleted Recap */}
                      <div className="rounded-md border border-[#C7D2FE] bg-white p-3.5 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4338CA]">
                          Key Meeting Decisions ({decisions.length})
                        </div>
                        {decisions.length > 0 ? (
                          <ul className="space-y-1.5 text-xs text-slate-800">
                            {decisions.map((decision, i) => (
                              <li key={i} className="flex items-start gap-2 leading-relaxed">
                                <span className="text-[#4F46E5] font-bold mt-0.5">•</span>
                                <span>{decision}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-slate-500">
                            No explicit decisions were finalized during this session.
                          </p>
                        )}
                      </div>

                      {summary.nextSteps.length > 0 && (
                        <div className="rounded-md border border-slate-200 bg-white p-3.5 space-y-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                            Agreed Next Steps
                          </div>
                          <ul className="space-y-1.5 text-xs text-slate-700">
                            {summary.nextSteps.map((step, i) => (
                              <li key={i} className="flex items-start gap-2 leading-relaxed">
                                <span className="font-mono text-[#4F46E5] font-semibold">
                                  {i + 1}.
                                </span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summary.facts.length > 0 && (
                        <div className="rounded-md border border-slate-200 bg-[#F8FAFC] p-3.5 space-y-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                            Observed Facts (Transcript Grounded)
                          </div>
                          <ul className="space-y-1.5 text-xs text-slate-700">
                            {summary.facts.map((fact, i) => (
                              <li key={i} className="flex items-start gap-2 leading-relaxed">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                <span>{fact}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summary.followUpEmail && (
                        <div className="rounded-md border border-slate-200 bg-white p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                              Follow-Up Email Draft
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onCopyText(summary.followUpEmail, 'Follow-up email copied')
                              }
                              className="text-[11px] font-medium text-[#4F46E5] hover:text-[#3525CD] inline-flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                          </div>
                          <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                            {summary.followUpEmail}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="py-10 px-4 text-center space-y-2.5">
                  <Sparkles className="w-5 h-5 text-[#4F46E5] mx-auto" />
                  <div className="text-xs font-semibold text-slate-800">
                    Meeting Decisions Recap
                  </div>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                    End a meeting with conversation turns to automatically synthesize a bulleted recap of key decisions, or trigger synthesis manually below.
                  </p>
                  <button
                    type="button"
                    onClick={() => onRegenerateSummary(selectedMeeting.id)}
                    className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Generate Recap Now
                  </button>
                </div>
              )}

              {/* Sentiment Analysis Timeline Chart below Meeting Recap */}
              <SentimentTimelineChart meeting={selectedMeeting} compact />
            </div>
          )}
        </section>
      </div>
            </>
          );
        })()}
      </>
      )}

      {matchedBattlecard && !showTimeline && (
        <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 px-1">
          <span>
            Armed Battlecard: <strong className="text-slate-700">{matchedBattlecard.competitorName}</strong>
            {' · '}
            <span className="text-slate-400">{matchedBattlecard.tagline}</span>
          </span>
          <span className="font-mono tabular-nums">
            Review {matchedBattlecard.reviewDate}
          </span>
        </div>
      )}
    </div>
  );
};
