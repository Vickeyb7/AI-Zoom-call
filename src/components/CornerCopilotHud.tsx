import React from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Lightbulb,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  ShieldAlert,
  Sparkles,
  Square,
  ThumbsUp,
  X,
} from 'lucide-react';
import type { AudioCaptureMode, LiveAudioCaptureState } from '../hooks/useLiveAudioCapture';
import type {
  Battlecard,
  DetectedSignalStatus,
  FeedbackRating,
  MeetingSession,
  SalesInsight,
} from '../types/sales';

export type HudCorner = 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left';

interface CornerCopilotHudProps {
  open: boolean;
  meeting: MeetingSession | null;
  battlecards: Battlecard[];
  analyzing: boolean;
  audioState: LiveAudioCaptureState;
  onStartAudioCapture: (mode: AudioCaptureMode) => Promise<boolean>;
  onStopAudioCapture: () => void;
  onInsightAction: (insightId: string, action: 'apply' | 'dismiss') => void;
  onInsightFeedback: (insightId: string, rating: FeedbackRating) => void;
  onCopyText: (text: string, label?: string) => void;
  onOpenAudioSettings: () => void;
  onClose: () => void;
}

const CORNER_CLASSES: Record<HudCorner, string> = {
  'bottom-right': 'bottom-4 right-4',
  'top-right': 'top-20 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-left': 'top-20 left-4',
};

const CORNER_ORDER: HudCorner[] = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];

function CornerIcon({ corner }: { corner: HudCorner }) {
  if (corner === 'bottom-right') return <ArrowDownRight className="w-3 h-3" />;
  if (corner === 'top-right') return <ArrowUpRight className="w-3 h-3" />;
  if (corner === 'bottom-left') return <ArrowDownLeft className="w-3 h-3" />;
  return <ArrowUpLeft className="w-3 h-3" />;
}

function statusPill(status?: DetectedSignalStatus, evolutionCount = 1): {
  label: string;
  className: string;
} {
  if (status === 'resolved') {
    return {
      label: 'Resolved',
      className: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    };
  }
  if (status === 'evolving' || evolutionCount > 1) {
    return {
      label: `Evolving x${evolutionCount}`,
      className: 'text-indigo-700 bg-indigo-50 border-indigo-200',
    };
  }
  return {
    label: 'Live Tip',
    className: 'text-amber-800 bg-amber-50 border-amber-200',
  };
}

export const CornerCopilotHud: React.FC<CornerCopilotHudProps> = ({
  open,
  meeting,
  battlecards,
  analyzing,
  audioState,
  onStartAudioCapture,
  onStopAudioCapture,
  onInsightAction,
  onInsightFeedback,
  onCopyText,
  onOpenAudioSettings,
  onClose,
}) => {
  const [corner, setCorner] = React.useState<HudCorner>('bottom-right');
  const [minimized, setMinimized] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [showSources, setShowSources] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const activeInsights = React.useMemo(
    () => (meeting ? meeting.insights.filter((i) => !i.dismissed) : []),
    [meeting],
  );

  const latestKey = activeInsights[0]
    ? `${activeInsights[0].id}:${activeInsights[0].evolutionCount || 1}:${activeInsights[0].objectionStatus}`
    : 'none';
  const prevLatestKeyRef = React.useRef<string>(latestKey);

  React.useEffect(() => {
    if (prevLatestKeyRef.current !== latestKey) {
      prevLatestKeyRef.current = latestKey;
      if (activeInsights.length > 0) {
        setActiveIndex(0);
        setMinimized(false);
        setShowSources(false);
      }
    }
  }, [latestKey, activeInsights.length]);

  const currentInsight: SalesInsight | undefined =
    activeInsights[Math.min(activeIndex, Math.max(0, activeInsights.length - 1))];

  const matchedBattlecard = React.useMemo(() => {
    const compName = currentInsight?.competitorName;
    if (!compName) return undefined;
    const target = compName.toLowerCase();
    return battlecards.find(
      (b) =>
        b.competitorName.toLowerCase() === target ||
        (b.aliases || []).some((a) => a.toLowerCase() === target),
    );
  }, [currentInsight?.competitorName, battlecards]);

  const weaknesses =
    currentInsight?.competitorWeaknesses && currentInsight.competitorWeaknesses.length > 0
      ? currentInsight.competitorWeaknesses
      : matchedBattlecard?.theirWeaknesses?.slice(0, 2);

  if (!open) return null;

  const cycleCorner = () => {
    const idx = CORNER_ORDER.indexOf(corner);
    setCorner(CORNER_ORDER[(idx + 1) % CORNER_ORDER.length]);
  };

  const handleCopy = (id: string, text: string) => {
    onCopyText(text, 'Counter-pitch copied');
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  // Ultra-compact corner pill when minimized so user has full screen unobstructed
  if (minimized) {
    return (
      <div
        className={`fixed ${CORNER_CLASSES[corner]} z-40 rounded-full bg-[#0F172A] text-white shadow-xl border border-indigo-500/40 px-3 py-1.5 flex items-center gap-2`}
      >
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 text-xs font-semibold hover:text-indigo-200"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>Copilot HUD</span>
          {activeInsights.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#4F46E5] text-[10px] font-mono">
              {activeInsights.length}
            </span>
          )}
          {audioState.capturing && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Expand Corner HUD"
          className="p-0.5 rounded hover:bg-slate-800 text-slate-300"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Corner HUD"
          className="p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Corner Copilot HUD"
      className={`fixed ${CORNER_CLASSES[corner]} z-40 w-[336px] max-w-[calc(100vw-24px)] rounded-xl bg-white text-slate-900 shadow-2xl border border-indigo-200 overflow-hidden`}
    >
      {/* Compact Dark Header */}
      <div className="px-3 py-2 bg-[#0F172A] text-white flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="text-[11px] font-semibold truncate">
            Copilot Corner HUD
          </span>
          {(analyzing || audioState.transcribingCount > 0) && (
            <Loader2 className="w-3 h-3 animate-spin text-indigo-300 shrink-0" />
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() =>
              audioState.capturing ? onStopAudioCapture() : void onStartAudioCapture('dual')
            }
            title={
              audioState.capturing
                ? 'Stop listening'
                : 'Listen to Zoom audio + Mic (No Bot)'
            }
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border inline-flex items-center gap-1 ${
              audioState.capturing
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
            }`}
          >
            {audioState.capturing ? (
              <>
                <Square className="w-2.5 h-2.5" /> Live
              </>
            ) : (
              <>
                <Mic className="w-2.5 h-2.5 text-emerald-400" /> Listen
              </>
            )}
          </button>

          {activeInsights.length > 1 && (
            <div className="flex items-center gap-0.5 text-[10px] font-mono text-slate-300">
              <button
                type="button"
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                disabled={activeIndex === 0}
                className="p-0.5 rounded hover:bg-slate-800 disabled:opacity-35"
                aria-label="Previous tip"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <span>
                {activeIndex + 1}/{activeInsights.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setActiveIndex((i) => Math.min(activeInsights.length - 1, i + 1))
                }
                disabled={activeIndex >= activeInsights.length - 1}
                className="p-0.5 rounded hover:bg-slate-800 disabled:opacity-35"
                aria-label="Next tip"
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={cycleCorner}
            title="Move HUD to another corner"
            className="p-1 rounded hover:bg-slate-800 text-slate-300"
          >
            <CornerIcon corner={corner} />
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            aria-label="Minimize Corner HUD"
            className="p-1 rounded hover:bg-slate-800 text-slate-300"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Corner HUD"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Scrollable Compact Card Body */}
      <div className="p-3 space-y-2 max-h-[340px] overflow-y-auto">
        {!currentInsight ? (
          <div className="py-3 text-center space-y-2">
            <div className="text-xs font-semibold text-slate-800">
              Monitoring in Corner
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
              Stay anywhere on the page. When a prospect mentions a competitor or objection, tips pop up right here.
            </p>
            <button
              type="button"
              onClick={onOpenAudioSettings}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE] hover:bg-indigo-100"
            >
              Audio Capture Options
            </button>
          </div>
        ) : (
          <>
            {(() => {
              const pill = statusPill(
                currentInsight.objectionStatus,
                currentInsight.evolutionCount || 1,
              );
              return (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[#4338CA] truncate">
                      {currentInsight.competitorName
                        ? `Competitor · ${currentInsight.competitorName}`
                        : currentInsight.objectionCategory || currentInsight.category}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold shrink-0 ${pill.className}`}
                    >
                      {pill.label}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-900 leading-snug">
                    {currentInsight.objectionDetected || currentInsight.title}
                  </div>
                </div>
              );
            })()}

            {currentInsight.competitorName && weaknesses && weaknesses.length > 0 && (
              <div className="rounded-md bg-[#FFFBEB] border border-[#FDE68A] p-2 space-y-0.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-[#92400E] flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-amber-600" />
                  {currentInsight.competitorName} Weaknesses
                </div>
                <ul className="space-y-0.5 text-[10.5px] text-amber-950 list-disc pl-3.5 leading-snug">
                  {weaknesses.slice(0, 2).map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {currentInsight.abstained && (
              <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] p-2 text-[10.5px] text-[#9F1239] flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 text-[#E11D48] shrink-0 mt-0.5" />
                <span>
                  {currentInsight.limitations[0] ||
                    'No verified battlecard on file—use discovery questions.'}
                </span>
              </div>
            )}

            <div className="rounded-md bg-[#EEF2FF]/75 border border-[#C7D2FE] p-2 space-y-1">
              <div className="text-[10.5px] text-[#312E81] leading-snug">
                <span className="font-bold">Approach: </span>
                {currentInsight.recommendedApproach || currentInsight.suggestedAction}
              </div>
              {currentInsight.suggestedResponse && (
                <div className="pt-1 border-t border-indigo-200/70 text-[11px] text-slate-900 leading-snug">
                  <span className="font-bold text-[#4338CA]">Pitch Now: </span>
                  &ldquo;{currentInsight.suggestedResponse}&rdquo;
                </div>
              )}
            </div>

            {currentInsight.discoveryQuestion && (
              <div className="flex items-start gap-1.5 rounded-md bg-slate-50 border border-slate-200 p-1.5 text-[10.5px] text-slate-800">
                <Lightbulb className="w-3 h-3 text-sky-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-sky-800">Ask Next: </span>
                  {currentInsight.discoveryQuestion}
                </div>
              </div>
            )}

            <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-1 text-[10.5px]">
              <button
                type="button"
                onClick={() => setShowSources((s) => !s)}
                className="inline-flex items-center gap-1 font-medium text-[#4F46E5] hover:underline"
              >
                <BookOpen className="w-3 h-3" />
                Sources ({currentInsight.supportingSources.length})
                {showSources ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>

              <div className="flex items-center gap-1">
                {currentInsight.suggestedResponse && (
                  <button
                    type="button"
                    onClick={() => handleCopy(currentInsight.id, currentInsight.suggestedResponse!)}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium inline-flex items-center gap-1"
                  >
                    {copiedId === currentInsight.id ? (
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
                <button
                  type="button"
                  onClick={() => onInsightFeedback(currentInsight.id, 'helpful')}
                  className={`p-1 rounded border ${
                    currentInsight.feedback?.rating === 'helpful'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                  aria-label="Mark useful"
                >
                  <ThumbsUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onInsightAction(currentInsight.id, 'dismiss')}
                  className="p-1 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                  aria-label="Dismiss tip"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {showSources && (
              <div className="space-y-1">
                {currentInsight.supportingSources.map((src, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-slate-200 bg-slate-50 p-1.5 text-[10px]"
                  >
                    <div className="font-semibold text-slate-800">{src.title}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
