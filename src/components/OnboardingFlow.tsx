import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Compass,
  Database,
  Loader2,
  MessageSquare,
  Mic,
  PictureInPicture2,
  Play,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import type {
  CopilotSessionMode,
  QuickAnswerStyle,
  SessionContextConfig,
} from '../types/sales';

interface OnboardingModeCard {
  id: CopilotSessionMode;
  title: string;
  description: string;
  defaultStyle: QuickAnswerStyle;
  exampleContext: string;
  sampleQuestion: { speakerName: string; text: string };
  icon: React.ComponentType<{ className?: string }>;
}

export const ONBOARDING_MODES: OnboardingModeCard[] = [
  {
    id: 'sales_call',
    title: 'Sales & Discovery Calls',
    description: 'Handle pricing objections, competitor comparisons, and security questions live.',
    defaultStyle: 'concise',
    exampleContext:
      'Enterprise Account Executive selling our real-time cloud testing & analytics platform. Highlight 3x faster CI execution, native Playwright/GitHub Actions support, SOC2 Type II, and 14-day guided pilot.',
    sampleQuestion: {
      speakerName: 'Samira Patel (VP Quality Engineering)',
      text: 'Your pricing seems significantly higher than LambdaTest. How do you justify the extra cost?',
    },
    icon: Briefcase,
  },
  {
    id: 'technical_interview',
    title: 'Technical Interviews',
    description: 'Get structured system design trade-offs, debugging steps, and clean code snippets.',
    defaultStyle: 'technical',
    exampleContext:
      'Senior Full-Stack & Distributed Systems Engineer with 7 years in TypeScript, Node.js, PostgreSQL, Redis, and multi-region Kubernetes deployments.',
    sampleQuestion: {
      speakerName: 'Staff Engineer (Interviewer)',
      text: 'How would you design a rate limiter for a distributed multi-region API gateway, and what algorithm would you choose?',
    },
    icon: Code2,
  },
  {
    id: 'behavioral_interview',
    title: 'Behavioral Interviews',
    description: 'Structure concise STAR stories grounded in your resume and past outcomes.',
    defaultStyle: 'star',
    exampleContext:
      'Engineering Lead who shipped a high-availability billing migration 2 weeks ahead of Q4 deadline, cutting checkout latency by 38% across 14M monthly transactions.',
    sampleQuestion: {
      speakerName: 'Hiring Manager (Interviewer)',
      text: 'Tell me about a time you had to ship a critical project with an incomplete spec and tight deadline.',
    },
    icon: MessageSquare,
  },
  {
    id: 'executive_briefing',
    title: 'Executive & Stakeholder Briefings',
    description: 'Answer CFO, CISO, and leadership questions with ROI, risk mitigation, and crisp framing.',
    defaultStyle: 'concise',
    exampleContext:
      'VP Solutions presenting Q1 platform consolidation roadmap: $420k projected annual savings, under 2-quarter payback, zero downtime cutover.',
    sampleQuestion: {
      speakerName: 'CFO (Board Member)',
      text: 'What is our payback period on this initiative and what is the biggest execution risk over the next two quarters?',
    },
    icon: Users,
  },
];

const ANSWER_STYLE_OPTIONS: { id: QuickAnswerStyle; label: string; hint: string }[] = [
  { id: 'concise', label: 'Concise', hint: '2-second scannable bullets' },
  { id: 'detailed', label: 'Detailed', hint: 'Full talking points' },
  { id: 'star', label: 'STAR', hint: 'Situation · Task · Action · Result' },
  { id: 'technical', label: 'Technical', hint: 'Architecture & code blocks' },
];

export interface OnboardingWizardModalProps {
  open: boolean;
  initialStep?: 1 | 2 | 3;
  userName?: string;
  currentContext?: SessionContextConfig;
  indexedDocsCount: number;
  battlecardsCount: number;
  onSaveContext: (patch: Partial<SessionContextConfig>) => Promise<void>;
  onOpenKnowledgeBase: () => void;
  onConnectAudio: () => void;
  onRunPracticeQuestion: (mode: CopilotSessionMode, style: QuickAnswerStyle) => void;
  onComplete: (mode?: CopilotSessionMode) => void;
  onSkip: () => void;
}

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({
  open,
  initialStep = 1,
  userName,
  currentContext,
  indexedDocsCount,
  battlecardsCount,
  onSaveContext,
  onOpenKnowledgeBase,
  onConnectAudio,
  onRunPracticeQuestion,
  onComplete,
  onSkip,
}) => {
  const [step, setStep] = React.useState<1 | 2 | 3>(initialStep);
  const [selectedMode, setSelectedMode] = React.useState<CopilotSessionMode>(
    currentContext?.mode || 'sales_call',
  );
  const [selectedStyle, setSelectedStyle] = React.useState<QuickAnswerStyle>(
    currentContext?.preferredStyle || 'concise',
  );
  const [background, setBackground] = React.useState<string>(
    currentContext?.userBackground || '',
  );
  const [savingStep1, setSavingStep1] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStep(initialStep);
    setSelectedMode(currentContext?.mode || 'sales_call');
    setSelectedStyle(currentContext?.preferredStyle || 'concise');
    setBackground(currentContext?.userBackground || '');
  }, [open, initialStep, currentContext?.mode, currentContext?.preferredStyle, currentContext?.userBackground]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSkip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onSkip]);

  if (!open) return null;

  const activeModeMeta =
    ONBOARDING_MODES.find((m) => m.id === selectedMode) || ONBOARDING_MODES[0];
  const firstName = userName?.trim().split(/\s+/)[0] || '';

  const handleSelectMode = (mode: OnboardingModeCard) => {
    setSelectedMode(mode.id);
    setSelectedStyle(mode.defaultStyle);
  };

  const handleContinueFromStep1 = async () => {
    setSavingStep1(true);
    try {
      await onSaveContext({
        mode: selectedMode,
        preferredStyle: selectedStyle,
        userBackground: background.trim(),
        autoAnswer: true,
      });
      setStep(2);
    } finally {
      setSavingStep1(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-wizard-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl overflow-hidden shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono tabular-nums font-semibold text-[#4338CA]">
                Step {step} of 3
              </span>
              <span aria-hidden="true">·</span>
              <span>Quick Setup Guide</span>
            </div>
            <h2
              id="onboarding-wizard-title"
              className="font-display text-lg font-semibold text-slate-900 mt-0.5 truncate"
            >
              {step === 1
                ? firstName
                  ? `Welcome, ${firstName} — set up your live copilot`
                  : 'Welcome — set up your live copilot'
                : step === 2
                ? 'Ground answers with your playbooks'
                : 'Start your first live session'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onSkip}
            aria-label="Close setup guide"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Progress Bar */}
        <div className="grid grid-cols-3 bg-slate-100 h-1 shrink-0">
          <div className="bg-[#4F46E5] transition-colors" />
          <div className={step >= 2 ? 'bg-[#4F46E5] transition-colors' : 'bg-transparent'} />
          <div className={step >= 3 ? 'bg-[#4F46E5] transition-colors' : 'bg-transparent'} />
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {step === 1 && (
            <>
              <p className="text-[13px] text-slate-600 leading-relaxed">
                Pick how you plan to use the copilot first. We&apos;ll tailor live answer formatting, sample prompts, and context guidance automatically—you can switch modes anytime.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ONBOARDING_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const active = selectedMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => handleSelectMode(mode)}
                      className={`text-left p-3.5 rounded-lg border transition-colors space-y-1.5 ${
                        active
                          ? 'bg-[#EEF2FF]/55 border-[#4F46E5] ring-1 ring-[#4F46E5]/20'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              active ? 'text-[#4F46E5]' : 'text-slate-500'
                            }`}
                          />
                          <span className="text-[13px] font-semibold text-slate-900 truncate">
                            {mode.title}
                          </span>
                        </div>
                        {active && (
                          <CheckCircle2 className="w-4 h-4 text-[#4F46E5] shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {mode.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="onboarding-background-input"
                    className="text-xs font-semibold text-slate-800"
                  >
                    Your role, product pitch, or resume notes{' '}
                    <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setBackground(activeModeMeta.exampleContext)}
                    className="text-xs font-medium text-[#4F46E5] hover:underline whitespace-nowrap"
                  >
                    Fill example
                  </button>
                </div>
                <textarea
                  id="onboarding-background-input"
                  rows={3}
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  placeholder="Paste key differentiators, product facts, or your resume highlights so instant answers stay specific to you..."
                  className="eki-input w-full rounded-md px-3 py-2 text-xs text-slate-900 leading-relaxed"
                />
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-800">
                  Default answer style
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ANSWER_STYLE_OPTIONS.map((opt) => {
                    const active = selectedStyle === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelectedStyle(opt.id)}
                        className={`px-3 py-2 rounded-md border text-left transition-colors ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="text-xs font-semibold">{opt.label}</div>
                        <div
                          className={`text-[10.5px] leading-tight mt-0.5 ${
                            active ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {opt.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-[13px] text-slate-600 leading-relaxed">
                Every live answer is grounded in your workspace documents and competitive battlecards—never unverified guesswork.
              </p>

              {/* Real Workspace Counts */}
              <div className="grid grid-cols-2 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-[#F8FAFC]">
                <div className="p-4">
                  <div className="text-xs text-slate-500">Indexed Knowledge Docs</div>
                  <div className="font-mono text-xl font-semibold tabular-nums text-slate-900 mt-1">
                    {indexedDocsCount}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Ready for semantic retrieval
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs text-slate-500">Competitive Battlecards</div>
                  <div className="font-mono text-xl font-semibold tabular-nums text-slate-900 mt-1">
                    {battlecardsCount}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Auto-surfaced on competitor mentions
                  </div>
                </div>
              </div>

              {/* Clean How-It-Works Breakdown */}
              <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-200">
                <div className="p-3.5 flex items-start gap-3">
                  <Database className="w-4 h-4 text-[#4F46E5] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-slate-900">
                      Upload PDFs, playbooks, or pricing sheets anytime
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Documents are chunked and embedded locally so your live answers cite exact sections and metrics.
                    </p>
                  </div>
                </div>
                <div className="p-3.5 flex items-start gap-3">
                  <Users className="w-4 h-4 text-[#4F46E5] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-slate-900">
                      Review Stakeholder Profiles during live calls
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Switch to the Stakeholders view beside the transcript to see past touchpoints and persistent notes for each detected speaker.
                    </p>
                  </div>
                </div>
                <div className="p-3.5 flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-slate-900">
                      Privacy-first zero-day transcript retention
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      When you end a call, key decisions and sentiment trends are captured automatically before raw transcripts are cleared.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-[#F8FAFC] px-4 py-3">
                <div className="text-xs text-slate-700">
                  Want to upload your own deck or playbook before your first call?
                </div>
                <button
                  type="button"
                  onClick={onOpenKnowledgeBase}
                  className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <BookOpen className="w-3.5 h-3.5 text-slate-600" />
                  Open Knowledge Base
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-[13px] text-slate-600 leading-relaxed">
                Choose how you want to start right now. You can capture real meeting audio silently (no bot joins your call) or test with a live sample question in seconds.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Path 1: Instant Practice Question */}
                <div className="rounded-lg border border-[#4F46E5] bg-[#EEF2FF]/35 p-4 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Play className="w-4 h-4 text-[#4F46E5]" />
                      <h3 className="font-display text-sm font-semibold">
                        Try a Live Practice Question
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Send a realistic <strong className="text-slate-800">{activeModeMeta.title.toLowerCase()}</strong> question to see live transcription, auto-scroll, and instant AI answers immediately.
                    </p>
                    <div className="rounded-md bg-white border border-indigo-200/80 p-2.5 text-[11px] text-slate-700 leading-relaxed">
                      &ldquo;{activeModeMeta.sampleQuestion.text}&rdquo;
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRunPracticeQuestion(selectedMode, selectedStyle)}
                    className="eki-btn-primary w-full py-2 px-3 rounded-md text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Run Live Practice Question
                  </button>
                </div>

                {/* Path 2: Connect Real Call Audio */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Mic className="w-4 h-4 text-emerald-600" />
                      <h3 className="font-display text-sm font-semibold">
                        Connect Live Call Audio
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Listen privately to Zoom, Google Meet, or Teams tab audio alongside your microphone using Deepgram speech-to-text. Zero bots enter the meeting.
                    </p>
                    <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-2.5 text-[11px] text-slate-600 leading-relaxed">
                      Tip: Toggle <strong>Stealth HUD</strong> in the top bar (or press <span className="font-mono">Alt+H</span>) for a discreet corner overlay during live calls.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onConnectAudio}
                    className="eki-btn-secondary w-full py-2 px-3 rounded-md text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <Mic className="w-3.5 h-3.5 text-slate-700" />
                    Connect Call Audio
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-[#F8FAFC] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={onSkip}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap"
              >
                Skip for now
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {step === 1 && (
              <button
                type="button"
                disabled={savingStep1}
                onClick={() => void handleContinueFromStep1()}
                className="eki-btn-primary px-4 py-2 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
              >
                {savingStep1 ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Save &amp; Continue
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(3)}
                className="eki-btn-primary px-4 py-2 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                Continue to Launch
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={() => onComplete(selectedMode)}
                className="eki-btn-secondary px-4 py-2 rounded-md text-xs font-medium whitespace-nowrap"
              >
                Explore Workspace on My Own
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export interface QuickStartChecklistBannerProps {
  checklist: {
    goalConfigured: boolean;
    knowledgeReviewed: boolean;
    liveSessionTested: boolean;
    stealthHudExplored: boolean;
  };
  onOpenWizard: (step?: 1 | 2 | 3) => void;
  onOpenKnowledgeBase: () => void;
  onConnectAudio: () => void;
  onRunSampleQuestion: () => void;
  onOpenStealthHud: () => void;
  onDismiss: () => void;
}

export const QuickStartChecklistBanner: React.FC<QuickStartChecklistBannerProps> = ({
  checklist,
  onOpenWizard,
  onOpenKnowledgeBase,
  onConnectAudio,
  onRunSampleQuestion,
  onOpenStealthHud,
  onDismiss,
}) => {
  const [expanded, setExpanded] = React.useState(true);

  const items = [
    {
      id: 'goal',
      done: checklist.goalConfigured,
      title: 'Set call mode & personal context',
      actionLabel: 'Configure',
      onAction: () => onOpenWizard(1),
    },
    {
      id: 'knowledge',
      done: checklist.knowledgeReviewed,
      title: 'Review or upload playbooks',
      actionLabel: 'Knowledge Base',
      onAction: onOpenKnowledgeBase,
    },
    {
      id: 'live',
      done: checklist.liveSessionTested,
      title: 'Test a live question or connect audio',
      actionLabel: 'Try Live Question',
      secondaryLabel: 'Connect Audio',
      onAction: onRunSampleQuestion,
      onSecondaryAction: onConnectAudio,
    },
    {
      id: 'hud',
      done: checklist.stealthHudExplored,
      title: 'Preview Stealth Overlay HUD',
      actionLabel: 'Open HUD',
      onAction: onOpenStealthHud,
    },
  ];

  const completedCount = items.filter((i) => i.done).length;
  const pct = Math.round((completedCount / items.length) * 100);

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Compass className="w-4 h-4 text-[#4F46E5] shrink-0" />
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs min-w-0">
            <span className="font-display font-semibold text-slate-900">
              Getting Started Checklist
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span className="font-mono tabular-nums text-slate-600">
              {completedCount}/{items.length} complete
            </span>
            <div className="hidden sm:block w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-[#4F46E5] transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onOpenWizard(1)}
            className="text-xs font-medium text-[#4F46E5] hover:underline whitespace-nowrap"
          >
            Setup Guide
          </button>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label={expanded ? 'Collapse getting started checklist' : 'Expand getting started checklist'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Dismiss getting started checklist"
            title="Dismiss checklist (you can reopen Setup Guide anytime from the sidebar)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 bg-[#F8FAFC]/60">
          {items.map((item) => (
            <div
              key={item.id}
              className={`rounded-md border px-3 py-2.5 flex flex-col justify-between gap-2 transition-colors ${
                item.done
                  ? 'bg-emerald-50/45 border-emerald-200/80'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 border ${
                    item.done
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {item.done && <Check className="w-2.5 h-2.5" />}
                </span>
                <span
                  className={`text-xs leading-snug ${
                    item.done ? 'text-slate-500 line-through' : 'font-medium text-slate-800'
                  }`}
                >
                  {item.title}
                </span>
              </div>

              {!item.done && (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <button
                    type="button"
                    onClick={item.onAction}
                    className="text-[11px] font-semibold text-[#4F46E5] hover:underline whitespace-nowrap inline-flex items-center gap-1"
                  >
                    {item.id === 'hud' && <PictureInPicture2 className="w-3 h-3" />}
                    {item.actionLabel}
                  </button>
                  {item.secondaryLabel && item.onSecondaryAction && (
                    <>
                      <span className="text-slate-300 text-[11px]" aria-hidden="true">
                        ·
                      </span>
                      <button
                        type="button"
                        onClick={item.onSecondaryAction}
                        className="text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap"
                      >
                        {item.secondaryLabel}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
