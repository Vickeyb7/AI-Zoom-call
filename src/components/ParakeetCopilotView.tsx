import React from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  FileText,
  Loader2,
  Mic,
  MonitorSpeaker,
  PictureInPicture2,
  Pin,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Square,
  Users,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import { matchesSearchTerms, renderHighlightedText } from './searchHighlight';
import { StakeholderProfileView } from './StakeholderProfileView';
import type { LiveAudioCaptureState } from '../hooks/useLiveAudioCapture';
import { useTranscriptAutoScroll } from '../hooks/useTranscriptAutoScroll';
import type {
  CopilotSessionMode,
  MeetingSession,
  QuickAnswerItem,
  QuickAnswerSpeed,
  QuickAnswerStyle,
  SessionContextConfig,
  SpeakerRole,
} from '../types/sales';

interface ParakeetCopilotViewProps {
  meetings: MeetingSession[];
  selectedMeeting: MeetingSession;
  apiHeaders: Record<string, string>;
  wsConnected: boolean;
  quickAnswering: boolean;
  quickAnswerQuestion: string | null;
  copilotError: string | null;
  elapsedClock: string;
  audioState: LiveAudioCaptureState;
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
  onOpenAudioModal: () => void;
  onStopAudioCapture: () => void;
  onOpenStealthHud: () => void;
  onEndCall: () => void;
  onResetMeeting: () => void;
  onCopyText: (text: string, label?: string) => void;
  onPushScratchpad: (text: string, sourceTitle?: string) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSwitchWorkspaceMode: (mode: 'parakeet' | 'strategy' | 'recap') => void;
}

const STYLE_OPTIONS: { id: QuickAnswerStyle; label: string; hint: string }[] = [
  { id: 'concise', label: 'Concise', hint: '2-second scan' },
  { id: 'detailed', label: 'Detailed', hint: 'Full talking points' },
  { id: 'star', label: 'STAR', hint: 'Situation · Task · Action · Result' },
  { id: 'technical', label: 'Technical', hint: 'Architecture & code' },
];

const MODE_OPTIONS: { id: CopilotSessionMode; label: string; speakerLabel: string }[] = [
  { id: 'sales_call', label: 'Sales Call', speakerLabel: 'Prospect' },
  { id: 'technical_interview', label: 'Technical Interview', speakerLabel: 'Interviewer' },
  { id: 'behavioral_interview', label: 'Behavioral Interview', speakerLabel: 'Interviewer' },
  { id: 'executive_briefing', label: 'Executive Briefing', speakerLabel: 'Stakeholder' },
];

const QUICK_SAMPLE_PROMPTS: Record<CopilotSessionMode, { speakerName: string; text: string }[]> = {
  sales_call: [
    {
      speakerName: 'Samira Patel (VP Quality Engineering)',
      text: 'Your pricing seems significantly higher than LambdaTest. How do you justify the extra cost?',
    },
    {
      speakerName: 'Marcus Chen (VP Engineering)',
      text: 'How do you handle SOC2 compliance, customer-managed encryption keys, and CI integrations?',
    },
    {
      speakerName: 'Elena Brooks (Procurement)',
      text: 'We are in a Q1 engineering freeze—how much work is it for our team to migrate?',
    },
  ],
  technical_interview: [
    {
      speakerName: 'Staff Engineer (Interviewer)',
      text: 'How would you design a rate limiter for a distributed multi-region API gateway, and what algorithm would you choose?',
    },
    {
      speakerName: 'Engineering Manager (Interviewer)',
      text: 'Walk me through how you would debug a sudden p99 latency spike in a Node.js and PostgreSQL service.',
    },
    {
      speakerName: 'Principal Engineer (Interviewer)',
      text: 'Write a clean TypeScript debounce function with cancellation and explain its edge cases.',
    },
  ],
  behavioral_interview: [
    {
      speakerName: 'Hiring Manager (Interviewer)',
      text: 'Tell me about a time you had to ship a critical project with an incomplete spec and tight deadline.',
    },
    {
      speakerName: 'VP Product (Interviewer)',
      text: 'Describe a disagreement you had with a senior stakeholder and how you reached alignment.',
    },
    {
      speakerName: 'Director of Engineering (Interviewer)',
      text: 'Tell me about a mistake or production outage you owned and what you changed afterward.',
    },
  ],
  executive_briefing: [
    {
      speakerName: 'CFO (Board Member)',
      text: 'What is our payback period on this initiative and what is the biggest execution risk over the next two quarters?',
    },
    {
      speakerName: 'Chief Product Officer',
      text: 'Why should we prioritize enterprise reliability over shipping three new self-serve features this quarter?',
    },
  ],
};

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.includes('?')) return true;
  const lower = t.toLowerCase();
  return /^(how|what|why|when|where|who|can you|could you|tell me|walk me through|explain|describe|compare|write)\b/.test(
    lower,
  );
}

export const ParakeetCopilotView: React.FC<ParakeetCopilotViewProps> = ({
  meetings,
  selectedMeeting,
  apiHeaders,
  wsConnected,
  quickAnswering,
  quickAnswerQuestion,
  copilotError,
  elapsedClock,
  audioState,
  onSelectMeeting,
  onSendTurn,
  onRequestQuickAnswer,
  onUpdateSessionContext,
  onOpenAudioModal,
  onStopAudioCapture,
  onOpenStealthHud,
  onEndCall,
  onResetMeeting,
  onCopyText,
  onPushScratchpad,
  searchQuery,
  onSearchQueryChange,
  onSwitchWorkspaceMode,
}) => {
  const ctx: SessionContextConfig = selectedMeeting.sessionContext || {
    mode: 'sales_call',
    autoAnswer: true,
    preferredStyle: 'concise',
    preferredSpeed: 'fast',
  };

  const [style, setStyle] = React.useState<QuickAnswerStyle>(ctx.preferredStyle || 'concise');
  const [speed, setSpeed] = React.useState<QuickAnswerSpeed>(ctx.preferredSpeed || 'fast');
  const [autoAnswer, setAutoAnswer] = React.useState<boolean>(ctx.autoAnswer !== false);
  const [leftPaneTab, setLeftPaneTab] = React.useState<'transcript' | 'notes'>('transcript');
  const [rightPaneMode, setRightPaneMode] = React.useState<'answers' | 'stakeholders'>('answers');
  const [manualInput, setManualInput] = React.useState('');
  const [noteInput, setNoteInput] = React.useState('');
  const [inputSpeaker, setInputSpeaker] = React.useState<'other' | 'you'>('other');
  const [contextOpen, setContextOpen] = React.useState(false);
  const [draftMode, setDraftMode] = React.useState<CopilotSessionMode>(ctx.mode || 'sales_call');
  const [draftBackground, setDraftBackground] = React.useState(ctx.userBackground || '');
  const [draftInstructions, setDraftInstructions] = React.useState(ctx.customInstructions || '');
  const [savingContext, setSavingContext] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [expandedHistoryIds, setExpandedHistoryIds] = React.useState<Record<string, boolean>>({});

  const latestTurn =
    selectedMeeting.transcript.length > 0
      ? selectedMeeting.transcript[selectedMeeting.transcript.length - 1]
      : null;

  const transcriptScroll = useTranscriptAutoScroll({
    meetingId: selectedMeeting.id,
    itemCount: selectedMeeting.transcript.length,
    latestItemKey: latestTurn ? `${latestTurn.id}:${latestTurn.text.length}` : 'empty',
    active: leftPaneTab === 'transcript',
    suspendAutoScroll: Boolean(searchQuery.trim()),
  });

  React.useEffect(() => {
    const next = selectedMeeting.sessionContext;
    setStyle(next?.preferredStyle || 'concise');
    setSpeed(next?.preferredSpeed || 'fast');
    setAutoAnswer(next?.autoAnswer !== false);
    setDraftMode(next?.mode || 'sales_call');
    setDraftBackground(next?.userBackground || '');
    setDraftInstructions(next?.customInstructions || '');
  }, [selectedMeeting.id, selectedMeeting.sessionContext]);

  const quickAnswers: QuickAnswerItem[] = selectedMeeting.quickAnswers || [];
  const latestAnswer = quickAnswers[0] || null;
  const previousAnswers = quickAnswers.slice(1);
  const isEnded = selectedMeeting.status === 'completed' || selectedMeeting.status === 'failed';
  const modeMeta = MODE_OPTIONS.find((m) => m.id === (ctx.mode || 'sales_call')) || MODE_OPTIONS[0];
  const samplePrompts = QUICK_SAMPLE_PROMPTS[ctx.mode || 'sales_call'] || QUICK_SAMPLE_PROMPTS.sales_call;

  const trimmedQuery = searchQuery.trim();
  const filteredTranscript = React.useMemo(
    () =>
      !trimmedQuery
        ? selectedMeeting.transcript
        : selectedMeeting.transcript.filter((turn) =>
            matchesSearchTerms(trimmedQuery, [
              turn.text,
              turn.speakerName,
              turn.speaker,
              ...(turn.detectedTags || []),
            ]),
          ),
    [selectedMeeting.transcript, trimmedQuery],
  );

  const filteredNotes = React.useMemo(
    () =>
      !trimmedQuery
        ? selectedMeeting.scratchpad
        : selectedMeeting.scratchpad.filter((note) =>
            matchesSearchTerms(trimmedQuery, [note.text, note.sourceTitle, note.createdAt]),
          ),
    [selectedMeeting.scratchpad, trimmedQuery],
  );

  // Hotkey: Cmd/Ctrl + Enter triggers Answer Now from anywhere outside text inputs
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') return;
        e.preventDefault();
        if (!quickAnswering) {
          void onRequestQuickAnswer({ style, speed });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRequestQuickAnswer, quickAnswering, style, speed]);

  const handleStyleChange = (nextStyle: QuickAnswerStyle) => {
    setStyle(nextStyle);
    void onUpdateSessionContext({ preferredStyle: nextStyle });
  };

  const handleSpeedChange = (nextSpeed: QuickAnswerSpeed) => {
    setSpeed(nextSpeed);
    void onUpdateSessionContext({ preferredSpeed: nextSpeed });
  };

  const handleToggleAutoAnswer = () => {
    const next = !autoAnswer;
    setAutoAnswer(next);
    void onUpdateSessionContext({ autoAnswer: next });
  };

  const handleSaveContext = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingContext(true);
    try {
      await onUpdateSessionContext({
        mode: draftMode,
        userBackground: draftBackground.trim(),
        customInstructions: draftInstructions.trim(),
        preferredStyle: style,
        preferredSpeed: speed,
        autoAnswer,
      });
      setContextOpen(false);
    } finally {
      setSavingContext(false);
    }
  };

  const handleCopy = (id: string, text: string, label = 'Answer copied') => {
    onCopyText(text, label);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1600);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = manualInput.trim();
    if (!text) return;

    if (inputSpeaker === 'other') {
      const otherName =
        selectedMeeting.prospectStakeholders[0] || `${modeMeta.speakerLabel}`;
      onSendTurn('Prospect', otherName, text);
      // If auto-answer is off, explicitly fire a quick answer so typing a question always feels instant
      if (!autoAnswer) {
        void onRequestQuickAnswer({ question: text, style, speed });
      }
    } else {
      onSendTurn('Sales Representative', `${selectedMeeting.aeName} (You)`, text);
    }
    setManualInput('');
  };

  const handleRunSamplePrompt = (sample: { speakerName: string; text: string }) => {
    onSendTurn('Prospect', sample.speakerName, sample.text);
    if (!autoAnswer) {
      void onRequestQuickAnswer({ question: sample.text, style, speed });
    }
  };

  const formatAnswerForCopy = (ans: QuickAnswerItem): string => {
    const lines = [
      ans.spokenAnswer,
      '',
      ...ans.keyBullets.map((b) => `- ${b}`),
    ];
    if (ans.codeSnippet) {
      lines.push('', `\`\`\`${ans.codeLanguage || ''}`, ans.codeSnippet, '```');
    }
    return lines.join('\n').trim();
  };

  return (
    <div className="space-y-4">
      {/* Clean Single-Row Live Copilot Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <select
            aria-label="Select live session"
            value={selectedMeeting.id}
            onChange={(e) => onSelectMeeting(e.target.value)}
            className="eki-input rounded-md px-3 py-1.5 text-[13px] font-semibold text-slate-900 max-w-[240px]"
          >
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.accountName} — {m.title}
              </option>
            ))}
          </select>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
            <span>{modeMeta.label}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-700 inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {elapsedClock}
            </span>
            <span aria-hidden="true">·</span>
            <span>{wsConnected ? 'Synced' : 'Reconnecting'}</span>
          </div>
        </div>

        {/* Center Segmented Workspace Switcher */}
        <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
          <button
            type="button"
            onClick={() => {
              setRightPaneMode('answers');
              onSwitchWorkspaceMode('parakeet');
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              rightPaneMode === 'answers'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Live Copilot
          </button>
          <button
            type="button"
            onClick={() => setRightPaneMode('stakeholders')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
              rightPaneMode === 'stakeholders'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Stakeholders
          </button>
          <button
            type="button"
            onClick={() => onSwitchWorkspaceMode('strategy')}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Deal Strategy
          </button>
          <button
            type="button"
            onClick={() => onSwitchWorkspaceMode('recap')}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Recap
          </button>
        </div>

        {/* Right Primary Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setContextOpen(true)}
            className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
            Context
          </button>

          <button
            type="button"
            onClick={onOpenStealthHud}
            className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            title="Open semi-transparent stealth floating overlay"
          >
            <PictureInPicture2 className="w-3.5 h-3.5 text-slate-600" />
            Stealth HUD
          </button>

          <button
            type="button"
            onClick={audioState.capturing ? onStopAudioCapture : onOpenAudioModal}
            className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              audioState.capturing
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-[#0F172A] hover:bg-slate-800 text-white'
            }`}
          >
            {audioState.capturing ? (
              <>
                <Square className="w-3 h-3" />
                Stop Audio
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5" />
                Listen Live
              </>
            )}
          </button>

          {!isEnded ? (
            <button
              type="button"
              onClick={onEndCall}
              className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium text-rose-700 hover:bg-rose-50 hover:border-rose-200 whitespace-nowrap shrink-0"
              title="End call and auto-generate key decisions recap"
            >
              End Call
            </button>
          ) : (
            <button
              type="button"
              onClick={onResetMeeting}
              className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              New Run
            </button>
          )}
        </div>
      </div>

      {/* Live Audio Stream Bar (only rendered when actively capturing mic/tab audio) */}
      {audioState.capturing && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/75 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-950">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
              Listening Privately (No Bot Joins)
            </span>
            {audioState.tabActive && (
              <div className="flex items-center gap-2">
                <MonitorSpeaker className="w-3.5 h-3.5 text-emerald-700" />
                <span>Call Audio</span>
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
                <Mic className="w-3.5 h-3.5 text-indigo-700" />
                <span>Your Mic</span>
                <div className="w-16 h-1.5 rounded-full bg-indigo-200 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-100"
                    style={{ width: `${audioState.micLevel}%` }}
                  />
                </div>
              </div>
            )}
            {audioState.transcribingCount > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-800">
                <Loader2 className="w-3 h-3 animate-spin" />
                Transcribing via Deepgram...
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onStopAudioCapture}
            className="text-xs font-semibold text-rose-700 hover:underline whitespace-nowrap"
          >
            Stop Listening
          </button>
        </div>
      )}

      {copilotError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-900">
          {copilotError}
        </div>
      )}

      {/* MAIN 2-PANE PARAKEET SPLIT LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* LEFT PANE (5 cols): Live Transcript, Pinned Notes & Live Search */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg flex flex-col lg:h-[calc(100vh-195px)] min-h-[560px]">
          <div className="px-4 py-3 border-b border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center p-0.5 bg-slate-100 rounded-md border border-slate-200/80">
                <button
                  type="button"
                  onClick={() => setLeftPaneTab('transcript')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                    leftPaneTab === 'transcript'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Transcript ({selectedMeeting.transcript.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLeftPaneTab('notes')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                    leftPaneTab === 'notes'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pinned Notes ({selectedMeeting.scratchpad.length})
                </button>
              </div>

              {leftPaneTab === 'transcript' && (
                <div className="flex items-center gap-2 shrink-0">
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

                  {selectedMeeting.transcript.length > 0 && (
                    <button
                      type="button"
                      onClick={onResetMeeting}
                      className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 whitespace-nowrap"
                      title="Clear transcript and start fresh"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Live Search Bar for Transcript & Pinned Notes */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && searchQuery) {
                    onSearchQueryChange('');
                  }
                }}
                aria-label="Filter transcript and pinned notes"
                placeholder="Search transcript & pinned notes..."
                className="eki-input w-full rounded-md pl-8 pr-8 py-1.5 text-xs text-slate-900"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchQueryChange('')}
                  aria-label="Clear search filter"
                  className="p-0.5 rounded text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {trimmedQuery && (
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 font-mono tabular-nums">
                <span>
                  Matches: {filteredTranscript.length}/{selectedMeeting.transcript.length} turns ·{' '}
                  {filteredNotes.length}/{selectedMeeting.scratchpad.length} pinned notes
                </span>
                <button
                  type="button"
                  onClick={() => onSearchQueryChange('')}
                  className="font-sans text-indigo-600 hover:underline font-medium"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {leftPaneTab === 'transcript' ? (
            <>
              <div className="relative flex-1 min-h-0 flex flex-col">
                <div
                  ref={transcriptScroll.containerRef}
                  onScroll={transcriptScroll.handleScroll}
                  className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC]/50"
                >
                {/* Inline Matching Pinned Notes Strip when searching from Transcript view */}
                {trimmedQuery && filteredNotes.length > 0 && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/45 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-indigo-900 inline-flex items-center gap-1.5">
                        <Pin className="w-3 h-3 text-indigo-600" />
                        Matching Pinned Notes ({filteredNotes.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => setLeftPaneTab('notes')}
                        className="text-[11px] font-medium text-indigo-700 hover:underline"
                      >
                        View notes
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {filteredNotes.slice(0, 3).map((note) => (
                        <div
                          key={note.id}
                          className="rounded-md bg-white border border-indigo-100 px-2.5 py-2 text-xs text-slate-800 space-y-0.5"
                        >
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span className="font-medium text-slate-700">
                              {renderHighlightedText(note.sourceTitle || 'Pinned Note', trimmedQuery)}
                            </span>
                            <span className="font-mono tabular-nums">{note.createdAt}</span>
                          </div>
                          <p className="leading-snug">
                            {renderHighlightedText(note.text, trimmedQuery)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedMeeting.transcript.length === 0 ? (
                  <div className="h-full flex flex-col justify-center space-y-5 py-6 px-2">
                    <div className="space-y-1.5">
                      <h3 className="font-display text-base font-semibold text-slate-900">
                        Ready to listen in real time
                      </h3>
                      <p className="text-[13px] text-slate-600 leading-relaxed">
                        Connect your call audio (Zoom, Google Meet, Teams) with zero bots joining, or click a live prompt below to test instant answers.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onOpenAudioModal}
                        className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Mic className="w-3.5 h-3.5" />
                        Connect Call Audio
                      </button>
                      <button
                        type="button"
                        onClick={() => setContextOpen(true)}
                        className="eki-btn-secondary px-4 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-600" />
                        Add Resume / Context
                      </button>
                    </div>

                    <div className="pt-3 border-t border-slate-200 space-y-2">
                      <div className="text-xs font-medium text-slate-500">
                        Try a live {modeMeta.label.toLowerCase()} question
                      </div>
                      <div className="space-y-2">
                        {samplePrompts.map((sample, idx) => (
                          <button
                            key={idx}
                            type="button"
                            disabled={quickAnswering}
                            onClick={() => handleRunSamplePrompt(sample)}
                            className="w-full text-left p-3 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors group disabled:opacity-60"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                              <span className="font-medium text-slate-700">{sample.speakerName}</span>
                              <span className="text-indigo-600 font-medium inline-flex items-center gap-1 opacity-80 group-hover:opacity-100">
                                <Play className="w-3 h-3" /> Ask
                              </span>
                            </div>
                            <p className="text-[13px] text-slate-800 leading-snug">
                              &ldquo;{sample.text}&rdquo;
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : filteredTranscript.length === 0 ? (
                  <div className="py-12 px-4 text-center space-y-2.5">
                    <Search className="w-5 h-5 text-slate-400 mx-auto" />
                    <div className="text-xs font-semibold text-slate-800">
                      No matching transcript turns
                    </div>
                    <p className="text-xs text-slate-500">
                      Nothing in the live transcript matched &ldquo;{trimmedQuery}&rdquo;.
                    </p>
                    <button
                      type="button"
                      onClick={() => onSearchQueryChange('')}
                      className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  filteredTranscript.map((turn, idx) => {
                    const isYou = turn.speaker === 'Sales Representative' || turn.speaker === 'AE';
                    const isLatest = !trimmedQuery && idx === filteredTranscript.length - 1;
                    const isQuestion = !isYou && looksLikeQuestion(turn.text);

                    return (
                      <div
                        key={turn.id}
                        className={`rounded-lg p-3.5 border transition-colors ${
                          isYou
                            ? 'bg-slate-50/90 border-slate-200/80'
                            : isLatest
                            ? 'bg-white border-indigo-300'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 text-xs min-w-0">
                            <span
                              className={`font-semibold truncate ${
                                isYou ? 'text-slate-600' : 'text-slate-900'
                              }`}
                            >
                              {renderHighlightedText(
                                isYou ? 'You' : turn.speakerName || modeMeta.speakerLabel,
                                trimmedQuery,
                              )}
                            </span>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-slate-400">
                              {turn.timestamp}
                            </span>
                            {isQuestion && (
                              <>
                                <span className="text-slate-300" aria-hidden="true">
                                  ·
                                </span>
                                <span className="text-indigo-600 font-medium">Question</span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                onPushScratchpad(
                                  turn.text,
                                  isYou ? 'You' : turn.speakerName || modeMeta.speakerLabel,
                                )
                              }
                              className="text-xs text-slate-400 hover:text-slate-700 inline-flex items-center gap-0.5"
                              title="Pin this line to call notes"
                            >
                              <Pin className="w-3 h-3" />
                            </button>
                            {!isYou && (
                              <button
                                type="button"
                                disabled={quickAnswering}
                                onClick={() =>
                                  void onRequestQuickAnswer({
                                    question: turn.text,
                                    style,
                                    speed,
                                  })
                                }
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-50"
                              >
                                <Zap className="w-3 h-3" />
                                Answer
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-[14px] text-slate-800 leading-relaxed">
                          {renderHighlightedText(turn.text, trimmedQuery)}
                        </p>
                      </div>
                    );
                  })
                )}
                </div>

                {transcriptScroll.showJumpToLatest && !trimmedQuery && (
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

              {/* Quick Question / Utterance Input */}
              <form
                onSubmit={handleManualSubmit}
                className="p-3 border-t border-slate-200 bg-white space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center p-0.5 bg-slate-100 rounded-md">
                    <button
                      type="button"
                      onClick={() => setInputSpeaker('other')}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                        inputSpeaker === 'other'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {modeMeta.speakerLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputSpeaker('you')}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                        inputSpeaker === 'you'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      You
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    Paste a live question or chat prompt
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={isEnded}
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder={
                      isEnded
                        ? 'Call ended — start a new run to continue'
                        : `Type or paste what the ${modeMeta.speakerLabel.toLowerCase()} asked...`
                    }
                    className="eki-input flex-1 rounded-md px-3 py-2 text-[13px] text-slate-900 disabled:bg-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={!manualInput.trim() || isEnded}
                    className="eki-btn-primary px-3.5 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Ask
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-[#F8FAFC]/50">
                {selectedMeeting.scratchpad.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-4 py-12 space-y-2">
                    <Pin className="w-5 h-5 text-slate-400" />
                    <div className="text-xs font-semibold text-slate-800">No pinned notes yet</div>
                    <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                      Pin key takeaways from transcript lines or jot down commitments below to keep them searchable during the call.
                    </p>
                  </div>
                ) : filteredNotes.length === 0 ? (
                  <div className="py-12 px-4 text-center space-y-2.5">
                    <Search className="w-5 h-5 text-slate-400 mx-auto" />
                    <div className="text-xs font-semibold text-slate-800">
                      No matching pinned notes
                    </div>
                    <p className="text-xs text-slate-500">
                      No pinned notes matched &ldquo;{trimmedQuery}&rdquo;.
                    </p>
                    <button
                      type="button"
                      onClick={() => onSearchQueryChange('')}
                      className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  filteredNotes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700 truncate">
                          {renderHighlightedText(note.sourceTitle || 'Pinned Note', trimmedQuery)}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
                          {note.createdAt}
                        </span>
                      </div>
                      <p className="text-[13px] text-slate-800 leading-relaxed">
                        {renderHighlightedText(note.text, trimmedQuery)}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!noteInput.trim()) return;
                  onPushScratchpad(noteInput.trim(), 'Pinned Note');
                  setNoteInput('');
                }}
                className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
              >
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Pin a commitment, metric, or follow-up note..."
                  className="eki-input flex-1 rounded-md px-3 py-2 text-[13px] text-slate-900"
                />
                <button
                  type="submit"
                  disabled={!noteInput.trim()}
                  className="eki-btn-primary px-3.5 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                >
                  <Pin className="w-3.5 h-3.5" />
                  Pin
                </button>
              </form>
            </>
          )}
        </section>

        {/* RIGHT PANE (7 cols): Instant AI Answer Feed or Stakeholder Profile View */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg flex flex-col lg:h-[calc(100vh-195px)] min-h-[560px]">
          {rightPaneMode === 'stakeholders' ? (
            <>
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Users className="w-4 h-4 text-[#4F46E5] shrink-0" />
                  <div className="min-w-0">
                    <h2 className="font-display text-sm font-semibold text-slate-900 truncate">
                      Stakeholder Profiles
                    </h2>
                    <div className="text-[11px] text-slate-500 truncate">
                      Past interactions &amp; historical notes for detected call participants
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRightPaneMode('answers')}
                  className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0"
                >
                  Back to AI Answers
                </button>
              </div>
              <StakeholderProfileView
                meeting={selectedMeeting}
                apiHeaders={apiHeaders}
                onCopyText={onCopyText}
              />
            </>
          ) : (
            <>
          {/* Instant Answer Control Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Dominant Primary CTA: Answer Now */}
              <button
                type="button"
                disabled={quickAnswering}
                onClick={() => void onRequestQuickAnswer({ style, speed })}
                className="eki-btn-primary px-4 py-2 rounded-md text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-60"
                title="Generate an instant answer for the latest question (Cmd/Ctrl + Enter)"
              >
                {quickAnswering ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Drafting Answer...
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    Answer Now
                  </>
                )}
              </button>

              {/* Response Style Segmented Control */}
              <div
                className="flex items-center p-0.5 bg-slate-100 rounded-md border border-slate-200/80"
                role="group"
                aria-label="Answer style"
              >
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleStyleChange(opt.id)}
                    title={opt.hint}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      style === opt.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-Answer + Model Speed Controls */}
            <div className="flex items-center gap-3 text-xs">
              <div
                className="flex items-center p-0.5 bg-slate-100 rounded-md border border-slate-200/80"
                role="group"
                aria-label="Model speed"
              >
                <button
                  type="button"
                  onClick={() => handleSpeedChange('fast')}
                  title="Groq Fast Model (openai/gpt-oss-20b) — lowest latency"
                  className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap ${
                    speed === 'fast'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Fast 20B
                </button>
                <button
                  type="button"
                  onClick={() => handleSpeedChange('deep')}
                  title="Groq Primary Model (openai/gpt-oss-120b) — deepest reasoning"
                  className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap ${
                    speed === 'deep'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Deep 120B
                </button>
              </div>

              <button
                type="button"
                onClick={handleToggleAutoAnswer}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap"
                title="Automatically draft answers when a question is spoken"
              >
                <span
                  className={`w-7 h-4 rounded-full transition-colors inline-flex items-center px-0.5 ${
                    autoAnswer ? 'bg-[#4F46E5] justify-end' : 'bg-slate-300 justify-start'
                  }`}
                >
                  <span className="w-3 h-3 rounded-full bg-white shadow-sm" />
                </span>
                <span>Auto</span>
              </button>
            </div>
          </div>

          {/* Instant Answer Stream */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-[#F8FAFC]/40">
            {/* Live Generating Skeleton Card */}
            {quickAnswering && (
              <div className="bg-white border border-indigo-200 rounded-lg p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-indigo-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    Synthesizing {style} answer via Groq ({speed === 'fast' ? '20B' : '120B'})...
                  </span>
                </div>
                {quickAnswerQuestion && (
                  <p className="text-xs text-slate-600">
                    Question: &ldquo;{quickAnswerQuestion}&rdquo;
                  </p>
                )}
                <div className="space-y-2 pt-1">
                  <div className="h-4 bg-slate-100 rounded w-11/12 animate-pulse" />
                  <div className="h-4 bg-slate-100 rounded w-9/12 animate-pulse" />
                  <div className="h-3 bg-slate-100 rounded w-7/12 animate-pulse" />
                </div>
              </div>
            )}

            {/* Empty Answer State */}
            {!latestAnswer && !quickAnswering && (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-12 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
                  <Wand2 className="w-5 h-5" />
                </div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Instant live answers appear here
                </h3>
                <p className="text-[13px] text-slate-600 leading-relaxed">
                  As soon as the {modeMeta.speakerLabel.toLowerCase()} asks a question—or whenever you click{' '}
                  <strong className="font-semibold text-slate-900">Answer Now</strong> (⌘↵)—you get natural spoken phrasing, scannable bullets, and Knowledge Base grounding in seconds.
                </p>
                <div className="text-xs text-slate-500 pt-1">
                  Auto-Answer is {autoAnswer ? 'enabled' : 'paused'} · Grounded in your uploaded docs &amp; context
                </div>
              </div>
            )}

            {/* HERO LATEST ANSWER CARD */}
            {latestAnswer && (
              <article className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                {/* Quiet Unboxed Metadata Line */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-indigo-700">Latest Answer</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{latestAnswer.style}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {latestAnswer.modelTier === 'fast' ? 'Groq 20B' : 'Groq 120B'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {(latestAnswer.latencyMs / 1000).toFixed(1)}s
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{latestAnswer.createdAt}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(latestAnswer.id, formatAnswerForCopy(latestAnswer))}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    {copiedId === latestAnswer.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>

                {/* Detected Question */}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">Question Detected</div>
                  <p className="text-[13px] text-slate-700 leading-snug">
                    &ldquo;{latestAnswer.detectedQuestion}&rdquo;
                  </p>
                </div>

                {/* Primary Spoken Answer (High-Legibility Teleprompter Block) */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {latestAnswer.headline}
                  </h3>
                  <p className="text-[15px] text-slate-900 leading-[1.65]">
                    {latestAnswer.spokenAnswer}
                  </p>
                </div>

                {/* Scannable Talking Points */}
                {latestAnswer.keyBullets.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 space-y-2">
                    <div className="text-xs font-semibold text-slate-700">Key Talking Points</div>
                    <ul className="space-y-1.5 text-[14px] text-slate-800 leading-relaxed list-disc pl-5">
                      {latestAnswer.keyBullets.map((bullet, idx) => (
                        <li key={idx}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Optional Technical / Code Snippet Block */}
                {latestAnswer.codeSnippet && (
                  <div className="rounded-lg bg-[#0F172A] text-slate-100 border border-slate-800 overflow-hidden">
                    <div className="px-3.5 py-2 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                        {latestAnswer.codeLanguage || 'code'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy(`${latestAnswer.id}-code`, latestAnswer.codeSnippet!, 'Code copied')
                        }
                        className="text-slate-300 hover:text-white inline-flex items-center gap-1"
                      >
                        {copiedId === `${latestAnswer.id}-code` ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy Code
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-3.5 text-xs font-mono leading-relaxed overflow-x-auto">
                      <code>{latestAnswer.codeSnippet}</code>
                    </pre>
                  </div>
                )}

                {/* Follow-Up Question to Keep Momentum */}
                {latestAnswer.followUpQuestion && (
                  <div className="pt-3 border-t border-slate-100 text-[13px] text-slate-700">
                    <span className="font-semibold text-slate-900">Ask back: </span>
                    {latestAnswer.followUpQuestion}
                  </div>
                )}

                {/* Grounding Sources + 1-Click Live Refinements */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-slate-500 min-w-0 truncate">
                    {latestAnswer.sources.length > 0 ? (
                      <span>
                        Grounded in:{' '}
                        <span className="text-slate-700 font-medium">
                          {latestAnswer.sources.map((s) => s.title).join(' · ')}
                        </span>
                      </span>
                    ) : (
                      <span>Grounded in live conversation &amp; session context</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={quickAnswering}
                      onClick={() =>
                        void onRequestQuickAnswer({
                          question: latestAnswer.detectedQuestion,
                          style: 'concise',
                          speed,
                          refineAction: 'shorter',
                          previousAnswer: latestAnswer.spokenAnswer,
                        })
                      }
                      className="eki-btn-secondary px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                    >
                      Shorter
                    </button>
                    <button
                      type="button"
                      disabled={quickAnswering}
                      onClick={() =>
                        void onRequestQuickAnswer({
                          question: latestAnswer.detectedQuestion,
                          style: 'detailed',
                          speed: 'deep',
                          refineAction: 'more_detail',
                          previousAnswer: latestAnswer.spokenAnswer,
                        })
                      }
                      className="eki-btn-secondary px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                    >
                      More Detail
                    </button>
                    <button
                      type="button"
                      disabled={quickAnswering}
                      onClick={() =>
                        void onRequestQuickAnswer({
                          question: latestAnswer.detectedQuestion,
                          style,
                          speed,
                          refineAction: 'regenerate',
                          previousAnswer: latestAnswer.spokenAnswer,
                        })
                      }
                      className="eki-btn-secondary px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1 disabled:opacity-50 whitespace-nowrap"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Regenerate
                    </button>
                  </div>
                </div>
              </article>
            )}

            {/* Earlier Answers History */}
            {previousAnswers.length > 0 && (
              <div className="space-y-2.5 pt-2">
                <div className="text-xs font-semibold text-slate-500">
                  Earlier in this session ({previousAnswers.length})
                </div>
                {previousAnswers.map((ans) => {
                  const isOpen = Boolean(expandedHistoryIds[ans.id]);
                  return (
                    <div
                      key={ans.id}
                      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedHistoryIds((prev) => ({ ...prev, [ans.id]: !prev[ans.id] }))
                        }
                        className="w-full px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-slate-900 truncate">
                            {ans.headline}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            &ldquo;{ans.detectedQuestion}&rdquo; ·{' '}
                            <span className="font-mono tabular-nums">{ans.createdAt}</span>
                          </div>
                        </div>
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                      </button>

                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-2.5 text-[13px] text-slate-800">
                          <p className="leading-relaxed">{ans.spokenAnswer}</p>
                          {ans.keyBullets.length > 0 && (
                            <ul className="list-disc pl-5 space-y-1 text-slate-700">
                              {ans.keyBullets.map((b, i) => (
                                <li key={i}>{b}</li>
                              ))}
                            </ul>
                          )}
                          <div className="pt-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleCopy(ans.id, formatAnswerForCopy(ans))}
                              className="text-xs font-medium text-indigo-600 hover:underline inline-flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" />
                              Copy Answer
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
            </>
          )}
        </section>
      </div>

      {/* Session Context & Resume Setup Slide-Over Modal */}
      {contextOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#0F172A]/40">
          <div className="bg-white w-full max-w-lg h-full border-l border-slate-200 flex flex-col eki-drawer">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Copilot Context &amp; Personalization
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tailor live answers to your role, resume, or call playbook
                </p>
              </div>
              <button
                type="button"
                onClick={() => setContextOpen(false)}
                aria-label="Close context drawer"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSaveContext}
              className="flex-1 overflow-y-auto p-6 space-y-5"
            >
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Session Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDraftMode(opt.id)}
                      className={`px-3 py-2.5 rounded-md border text-left text-xs font-medium transition-colors ${
                        draftMode === opt.id
                          ? 'bg-indigo-50 border-indigo-400 text-indigo-900'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Your Background, Resume, or Product Pitch
                </label>
                <p className="text-xs text-slate-500">
                  Paste your resume highlights, past projects, or key product facts. Uploaded Knowledge Base files are also searched automatically via local BAAI/bge-m3 embeddings.
                </p>
                <textarea
                  rows={6}
                  value={draftBackground}
                  onChange={(e) => setDraftBackground(e.target.value)}
                  placeholder="e.g. Senior Staff Engineer with 8 years building distributed payment systems in TypeScript, Go, and Postgres. Led zero-downtime multi-region migration cutting p99 latency by 44%..."
                  className="eki-input w-full rounded-md px-3 py-2 text-[13px] text-slate-900 leading-relaxed"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Custom Instructions
                </label>
                <textarea
                  rows={4}
                  value={draftInstructions}
                  onChange={(e) => setDraftInstructions(e.target.value)}
                  placeholder="e.g. Keep spoken answers under 30 seconds. Speak naturally without buzzwords. Always connect back to measurable ROI or production reliability."
                  className="eki-input w-full rounded-md px-3 py-2 text-[13px] text-slate-900 leading-relaxed"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setContextOpen(false)}
                  className="eki-btn-secondary px-4 py-2 rounded-md text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingContext}
                  className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium disabled:opacity-60"
                >
                  {savingContext ? 'Saving...' : 'Save Context'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
