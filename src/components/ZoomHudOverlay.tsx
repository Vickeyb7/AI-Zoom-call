import React from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  GripHorizontal,
  Lightbulb,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  ThumbsUp,
  Users,
  Video,
  X,
} from 'lucide-react';
import type {
  Battlecard,
  DetectedSignalStatus,
  FeedbackRating,
  MeetingSession,
  SalesInsight,
  SpeakerRole,
} from '../types/sales';

interface ZoomHudOverlayProps {
  selectedMeeting: MeetingSession;
  battlecards: Battlecard[];
  analyzing: boolean;
  simPlaying: boolean;
  simStep: number;
  scenarioTotalTurns: number;
  elapsedClock: string;
  isLive: boolean;
  isPaused: boolean;
  isEnded: boolean;
  isReady: boolean;
  onStartOrPlay: () => void;
  onPause: () => void;
  onStepTurn: () => void;
  onEnd: () => void;
  onReset: () => void;
  onSendTurn: (speaker: SpeakerRole, speakerName: string, text: string) => void;
  onInsightAction: (insightId: string, action: 'apply' | 'dismiss') => void;
  onInsightFeedback: (insightId: string, rating: FeedbackRating) => void;
  onOpenRiskDrawer: () => void;
  onCopyText: (text: string, label?: string) => void;
  onExitZoomMode: () => void;
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
    label: 'Live Objection',
    className: 'text-amber-800 bg-amber-50 border-amber-200',
  };
}

export const ZoomHudOverlay: React.FC<ZoomHudOverlayProps> = ({
  selectedMeeting,
  battlecards,
  analyzing,
  simPlaying,
  simStep,
  scenarioTotalTurns,
  elapsedClock,
  isLive,
  isPaused,
  isEnded,
  isReady,
  onStartOrPlay,
  onPause,
  onStepTurn,
  onEnd,
  onReset,
  onSendTurn,
  onInsightAction,
  onInsightFeedback,
  onOpenRiskDrawer,
  onCopyText,
  onExitZoomMode,
}) => {
  const activeInsights = React.useMemo(
    () => selectedMeeting.insights.filter((i) => !i.dismissed),
    [selectedMeeting.insights],
  );

  const [activeIndex, setActiveIndex] = React.useState(0);
  const [minimized, setMinimized] = React.useState(false);
  const [showEvidence, setShowEvidence] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [speaker, setSpeaker] = React.useState<SpeakerRole>('Prospect');
  const [utterance, setUtterance] = React.useState('');

  // Draggable floating HUD offset inside the Zoom stage
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );

  // Auto-focus newest insight and auto-expand HUD whenever a new tip or evolution arrives
  const latestUpdateKey = activeInsights[0]
    ? `${activeInsights[0].id}:${activeInsights[0].evolutionCount || 1}:${activeInsights[0].objectionStatus}`
    : 'none';

  React.useEffect(() => {
    if (activeInsights.length > 0) {
      setActiveIndex(0);
      setMinimized(false);
      setShowEvidence(false);
    }
  }, [latestUpdateKey, activeInsights.length]);

  React.useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setOffset({
        x: Math.max(-520, Math.min(20, dragRef.current.origX + dx)),
        y: Math.max(-220, Math.min(220, dragRef.current.origY + dy)),
      });
    };
    const handlePointerUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

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
      : matchedBattlecard?.theirWeaknesses?.slice(0, 3);

  const latestTurn = selectedMeeting.transcript[selectedMeeting.transcript.length - 1];
  const recentCaptions = selectedMeeting.transcript.slice(-2);
  const prospectSpeaking =
    latestTurn && latestTurn.speaker !== 'Sales Representative' && latestTurn.speaker !== 'AE';
  const repSpeaking =
    latestTurn && (latestTurn.speaker === 'Sales Representative' || latestTurn.speaker === 'AE');

  const prospectName = selectedMeeting.prospectStakeholders[0] || 'Prospect';
  const repName = `${selectedMeeting.aeName} (You)`;

  const handleCopy = (id: string, text: string) => {
    onCopyText(text, 'Counter-pitch copied');
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!utterance.trim() || analyzing || isPaused || isEnded) return;
    const sName =
      speaker === 'Sales Representative'
        ? `${selectedMeeting.aeName} (Sales Rep)`
        : prospectName;
    onSendTurn(speaker, sName, utterance.trim());
    setUtterance('');
  };

  return (
    <div className="rounded-xl overflow-hidden border border-slate-800 bg-[#0B1120] text-slate-100 shadow-xl">
      {/* Zoom Top Window Chrome */}
      <div className="px-4 py-2.5 bg-[#0F172A] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium shrink-0">
            <ShieldCheck className="w-4 h-4" />
            <span className="hidden sm:inline">Simulated Zoom Call</span>
          </div>
          <span className="text-slate-700" aria-hidden="true">
            |
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">
              {selectedMeeting.accountName} — {selectedMeeting.title}
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              Meeting ID: 842-910-4418 · {battlecards.length} Battlecards Indexed
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-flex items-center gap-1.5 ${
              isLive
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : isPaused
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'bg-slate-800 text-slate-300 border border-slate-700'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isLive ? 'bg-emerald-400 animate-pulse' : isPaused ? 'bg-amber-400' : 'bg-indigo-400'
              }`}
            />
            {isLive ? 'LIVE' : isPaused ? 'PAUSED' : isEnded ? 'ENDED' : 'READY'}
          </span>

          <span className="font-mono text-xs tabular-nums text-slate-200 bg-slate-900 border border-slate-700 px-2 py-0.5 rounded inline-flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-400" />
            {elapsedClock}
          </span>

          <button
            type="button"
            onClick={onExitZoomMode}
            className="px-2.5 py-1 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            3-Panel Workspace
          </button>
        </div>
      </div>

      {/* Main Zoom Video Stage + Floating Small Copilot Window */}
      <div className="relative min-h-[560px] p-4 sm:p-5 bg-gradient-to-b from-[#0B1120] to-[#111827] flex flex-col justify-between gap-4">
        {/* Video Gallery Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
          {/* Prospect Tile */}
          <div
            className={`relative rounded-xl bg-[#131C31] border flex flex-col items-center justify-center p-6 min-h-[260px] transition-all ${
              prospectSpeaking
                ? 'border-emerald-400 ring-2 ring-emerald-500/30'
                : 'border-slate-800'
            }`}
          >
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-2xl font-display font-bold text-white shadow-lg">
              {prospectName
                .split(' ')
                .slice(0, 2)
                .map((p) => p[0])
                .join('')}
            </div>
            <div className="mt-3 text-sm font-semibold text-white">{prospectName}</div>
            <div className="text-xs text-slate-400">Prospect · {selectedMeeting.accountName}</div>

            <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/45 text-[11px] text-slate-200 flex items-center gap-1.5">
              <Video className="w-3 h-3 text-emerald-400" />
              <span>External Guest</span>
            </div>

            {prospectSpeaking && (
              <div className="absolute bottom-3 left-3 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-[11px] font-medium text-emerald-300">
                Speaking now
              </div>
            )}
          </div>

          {/* Sales Rep Tile */}
          <div
            className={`relative rounded-xl bg-[#131C31] border flex flex-col items-center justify-center p-6 min-h-[260px] transition-all ${
              repSpeaking ? 'border-indigo-400 ring-2 ring-indigo-500/30' : 'border-slate-800'
            }`}
          >
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 flex items-center justify-center text-2xl font-display font-bold text-white shadow-lg">
              {selectedMeeting.aeName
                .split(' ')
                .slice(0, 2)
                .map((p) => p[0])
                .join('')}
            </div>
            <div className="mt-3 text-sm font-semibold text-white">{repName}</div>
            <div className="text-xs text-slate-400">Account Executive · Host</div>

            <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/45 text-[11px] text-slate-200 flex items-center gap-1.5">
              <Users className="w-3 h-3 text-indigo-400" />
              <span>Rep Talk: {selectedMeeting.aeTalkRatio}%</span>
            </div>

            {repSpeaking && (
              <div className="absolute bottom-3 left-3 px-2 py-0.5 rounded bg-indigo-500/20 border border-indigo-400/40 text-[11px] font-medium text-indigo-300">
                Speaking now
              </div>
            )}
          </div>
        </div>

        {/* Live Zoom Captions Strip */}
        <div className="rounded-lg bg-black/55 border border-slate-800/90 px-4 py-2.5 max-w-2xl">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Live Call Transcript Captions
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {selectedMeeting.transcript.length} turn(s)
            </span>
          </div>
          {recentCaptions.length === 0 ? (
            <p className="text-xs text-slate-400">
              Click <strong className="text-white">Start &amp; Play</strong> or type a prospect line below—the small Copilot Window will appear automatically on objections or competitor mentions.
            </p>
          ) : (
            <div className="space-y-1">
              {recentCaptions.map((turn) => {
                const isRep =
                  turn.speaker === 'Sales Representative' || turn.speaker === 'AE';
                return (
                  <div key={turn.id} className="text-xs leading-snug">
                    <span
                      className={`font-semibold mr-1.5 ${
                        isRep ? 'text-indigo-300' : 'text-emerald-300'
                      }`}
                    >
                      {isRep ? 'Sales Rep' : 'Prospect'}:
                    </span>
                    <span className="text-slate-100">&ldquo;{turn.text}&rdquo;</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* FLOATING SMALL CORNER COPILOT WINDOW */}
        <div
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
          className="fixed bottom-4 right-4 sm:absolute sm:bottom-3 sm:right-3 z-20 w-[330px] max-w-[calc(100vw-24px)] rounded-xl bg-white text-slate-900 shadow-2xl border border-indigo-200 overflow-hidden"
        >
          {/* Draggable HUD Header */}
          <div
            onPointerDown={(e) => {
              dragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                origX: offset.x,
                origY: offset.y,
              };
            }}
            className="px-3 py-2 bg-[#0F172A] text-white flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing select-none"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="text-[11px] font-semibold truncate">
                AI Sales Copilot · Corner HUD
              </span>
              {analyzing && (
                <span className="inline-flex items-center gap-1 text-[10px] text-indigo-300">
                  <Loader2 className="w-3 h-3 animate-spin" />
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeInsights.length > 1 && (
                <div className="flex items-center gap-0.5 text-[10px] font-mono text-slate-300 mr-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveIndex((prev) => Math.max(0, prev - 1));
                    }}
                    disabled={activeIndex === 0}
                    className="p-0.5 rounded hover:bg-slate-800 disabled:opacity-35"
                    aria-label="Previous recommendation"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span>
                    {activeIndex + 1}/{activeInsights.length}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveIndex((prev) => Math.min(activeInsights.length - 1, prev + 1));
                    }}
                    disabled={activeIndex >= activeInsights.length - 1}
                    className="p-0.5 rounded hover:bg-slate-800 disabled:opacity-35"
                    aria-label="Next recommendation"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <GripHorizontal className="w-3.5 h-3.5 text-slate-500 hidden md:block" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMinimized((m) => !m);
                }}
                aria-label={minimized ? 'Expand Copilot HUD' : 'Minimize Copilot HUD'}
                className="p-1 rounded hover:bg-slate-800 text-slate-300"
              >
                {minimized ? (
                  <Maximize2 className="w-3.5 h-3.5" />
                ) : (
                  <Minimize2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {!minimized && (
            <div className="p-3 space-y-2 max-h-[330px] overflow-y-auto">
              {!currentInsight ? (
                <div className="py-6 text-center space-y-2">
                  <Sparkles className="w-5 h-5 text-[#4F46E5] mx-auto" />
                  <div className="text-xs font-semibold text-slate-800">
                    Monitoring Live Call Context
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
                    When the prospect mentions any competitor (e.g. LambdaTest, BrowserStack, Sauce Labs) or raises a concern, this small window updates automatically with their weaknesses and your counter-pitch.
                  </p>
                </div>
              ) : (
                <>
                  {/* 1. Detected Signal + Context Basis */}
                  {(() => {
                    const pill = statusPill(
                      currentInsight.objectionStatus,
                      currentInsight.evolutionCount || 1,
                    );
                    return (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-[#4338CA]">
                            {currentInsight.competitorName
                              ? `Competitor · ${currentInsight.competitorName}`
                              : currentInsight.objectionCategory || currentInsight.category}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${pill.className}`}
                            >
                              {pill.label}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                              {currentInsight.confidenceScore || 85}%
                            </span>
                          </div>
                        </div>

                        <h4 className="text-[13px] font-bold text-slate-900 leading-snug">
                          {currentInsight.objectionDetected || currentInsight.title}
                        </h4>

                        {currentInsight.conversationBasis && (
                          <div className="text-[10px] font-mono text-slate-500">
                            {currentInsight.conversationBasis}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* 2. Competitor Weaknesses Strip (from verified Battlecard) */}
                  {currentInsight.competitorName && weaknesses && weaknesses.length > 0 && (
                    <div className="rounded-md bg-[#FFFBEB] border border-[#FDE68A] p-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#92400E] flex items-center gap-1">
                          <ShieldAlert className="w-3 h-3 text-amber-600" />
                          {currentInsight.competitorName} Weaknesses to Exploit
                        </span>
                        <button
                          type="button"
                          onClick={onOpenRiskDrawer}
                          className="text-[10px] font-semibold text-[#92400E] underline"
                        >
                          Full Card
                        </button>
                      </div>
                      <ul className="space-y-0.5 text-[11px] text-amber-950 list-disc pl-4 leading-snug">
                        {weaknesses.slice(0, 2).map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Honest abstention / uncatalogued competitor notice */}
                  {currentInsight.abstained && (
                    <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] p-2 text-[11px] text-[#9F1239] flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#E11D48] shrink-0 mt-0.5" />
                      <span>
                        {currentInsight.limitations[0] ||
                          'No verified battlecard on file for this claim—use discovery questions rather than improvising.'}
                      </span>
                    </div>
                  )}

                  {/* 3. Underlying Concern */}
                  <div className="text-[11px] text-slate-700 leading-snug">
                    <span className="font-semibold text-slate-900">Why they said this: </span>
                    {currentInsight.underlyingConcern || currentInsight.interpretation}
                  </div>

                  {/* 4. What to Pitch Right Now */}
                  <div className="rounded-md bg-[#EEF2FF]/70 border border-[#C7D2FE] p-2.5 space-y-1.5">
                    <div className="text-[11px] text-[#312E81] leading-snug">
                      <span className="font-bold">Approach: </span>
                      {currentInsight.recommendedApproach || currentInsight.suggestedAction}
                    </div>

                    {currentInsight.suggestedResponse && (
                      <div className="pt-1.5 border-t border-indigo-200/70 text-xs text-slate-900 leading-relaxed">
                        <span className="font-bold text-[#4338CA]">Pitch Now: </span>
                        &ldquo;{currentInsight.suggestedResponse}&rdquo;
                      </div>
                    )}
                  </div>

                  {/* 5. Ask Next */}
                  {currentInsight.discoveryQuestion && (
                    <div className="flex items-start gap-1.5 rounded-md bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-800">
                      <Lightbulb className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-sky-800">Ask Next: </span>
                        {currentInsight.discoveryQuestion}
                      </div>
                    </div>
                  )}

                  {/* 6. Grounding Sources + Quick Actions */}
                  <div className="pt-1 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setShowEvidence((s) => !s)}
                      className="inline-flex items-center gap-1 font-medium text-[#4F46E5] hover:underline"
                    >
                      <BookOpen className="w-3 h-3" />
                      Sources ({currentInsight.supportingSources.length})
                      {showEvidence ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>

                    <div className="flex items-center gap-1">
                      {currentInsight.suggestedResponse && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(currentInsight.id, currentInsight.suggestedResponse!)
                          }
                          className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium inline-flex items-center gap-1"
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
                        className={`px-2 py-1 rounded border font-medium inline-flex items-center gap-1 ${
                          currentInsight.feedback?.rating === 'helpful'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onInsightAction(currentInsight.id, 'dismiss')}
                        className="p-1 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                        aria-label="Dismiss tip"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {showEvidence && (
                    <div className="space-y-1.5">
                      {currentInsight.supportingSources.length === 0 ? (
                        <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                          No matching approved Knowledge Base document cited.
                        </div>
                      ) : (
                        currentInsight.supportingSources.map((src, sIdx) => (
                          <div
                            key={sIdx}
                            className="rounded border border-slate-200 bg-slate-50 p-2 text-[10px] space-y-0.5"
                          >
                            <div className="font-semibold text-slate-800 flex items-center justify-between gap-2">
                              <span className="truncate">{src.title}</span>
                              <span className="font-mono text-slate-500 shrink-0">
                                {src.sourceMode === 'mock_kb' ? 'Mock KB' : 'Uploaded KB'}
                              </span>
                            </div>
                            {src.excerpt && (
                              <p className="text-slate-600 line-clamp-2">{src.excerpt}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Zoom Bottom Toolbar + Instant Live Line Simulator */}
      <div className="px-4 py-3 bg-[#0F172A] border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(!isLive || !simPlaying) && !isEnded && (
            <button
              type="button"
              onClick={onStartOrPlay}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#4F46E5] hover:bg-[#4338CA] text-white inline-flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              {isPaused ? 'Resume' : isReady ? 'Start & Play Call' : 'Play Simulation'}
            </button>
          )}
          {isLive && (
            <button
              type="button"
              onClick={onPause}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 inline-flex items-center gap-1.5"
            >
              <Pause className="w-3.5 h-3.5" /> Pause
            </button>
          )}
          <button
            type="button"
            disabled={isPaused || isEnded || analyzing}
            onClick={onStepTurn}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1 disabled:opacity-40"
          >
            <RefreshCw className="w-3 h-3" />
            Step ({Math.min(simStep, scenarioTotalTurns)}/{scenarioTotalTurns})
          </button>
          {!isEnded && (
            <button
              type="button"
              onClick={onEnd}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 inline-flex items-center gap-1"
            >
              <Square className="w-3 h-3" /> End Call
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>

        {/* Live Line Injector for testing ANY of 100+ competitors on the fly */}
        <form onSubmit={handleCustomSubmit} className="flex flex-1 min-w-[280px] max-w-xl items-center gap-1.5">
          <select
            aria-label="Speaker role"
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value as SpeakerRole)}
            className="rounded-md bg-slate-800 border border-slate-700 px-2 py-1.5 text-xs text-slate-200"
          >
            <option value="Prospect">Prospect</option>
            <option value="Sales Representative">Sales Rep</option>
          </select>
          <input
            type="text"
            disabled={isPaused || isEnded}
            value={utterance}
            onChange={(e) => setUtterance(e.target.value)}
            placeholder="Test any competitor or objection (e.g. 'We currently use BrowserStack')"
            className="flex-1 rounded-md bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!utterance.trim() || analyzing || isPaused || isEnded}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#4F46E5] hover:bg-[#4338CA] text-white inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Send className="w-3 h-3" /> Speak
          </button>
        </form>
      </div>
    </div>
  );
};
