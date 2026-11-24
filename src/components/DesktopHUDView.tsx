import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  EyeOff,
  Lightbulb,
  Loader2,
  Mic,
  MonitorSpeaker,
  Pin,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  ThumbsUp,
  Video,
  X,
} from 'lucide-react';
import type { AudioCaptureMode, LiveAudioCaptureState } from '../hooks/useLiveAudioCapture';
import type {
  Battlecard,
  DetectedSignalStatus,
  FeedbackRating,
  MeetingSession,
  SalesInsight,
  SpeakerRole,
} from '../types/sales';

interface DesktopHudBridge {
  isElectron?: boolean;
  setContentProtection: (enabled: boolean) => Promise<{ contentProtection: boolean; alwaysOnTop: boolean }>;
  setAlwaysOnTop: (enabled: boolean) => Promise<{ contentProtection: boolean; alwaysOnTop: boolean }>;
  getWindowState: () => Promise<{ contentProtection: boolean; alwaysOnTop: boolean }>;
  hideHud: () => Promise<boolean>;
  openFullWorkspace: (url?: string) => Promise<boolean>;
  onWindowStateChange: (cb: (state: { contentProtection: boolean; alwaysOnTop: boolean }) => void) => () => void;
}

declare global {
  interface Window {
    desktopHud?: DesktopHudBridge;
  }
}

interface DesktopHUDViewProps {
  meetings: MeetingSession[];
  selectedMeeting: MeetingSession | null;
  battlecards: Battlecard[];
  wsConnected: boolean;
  analyzing: boolean;
  copilotError: string | null;
  audioState: LiveAudioCaptureState;
  onStartAudioCapture: (mode: AudioCaptureMode) => Promise<boolean>;
  onStopAudioCapture: () => void;
  onSelectMeeting: (meetingId: string) => void;
  onSendTurn: (speaker: SpeakerRole, speakerName: string, text: string) => void;
  onInsightAction: (insightId: string, action: 'apply' | 'dismiss') => void;
  onInsightFeedback: (insightId: string, rating: FeedbackRating) => void;
  onCopyText: (text: string, label?: string) => void;
  onOpenZoomModal: () => void;
  onExitDesktopHud: () => void;
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

export const DesktopHUDView: React.FC<DesktopHUDViewProps> = ({
  meetings,
  selectedMeeting,
  battlecards,
  wsConnected,
  analyzing,
  copilotError,
  audioState,
  onStartAudioCapture,
  onStopAudioCapture,
  onSelectMeeting,
  onSendTurn,
  onInsightAction,
  onInsightFeedback,
  onCopyText,
  onOpenZoomModal,
  onExitDesktopHud,
}) => {
  const bridge = typeof window !== 'undefined' ? window.desktopHud : undefined;
  const isElectron = Boolean(bridge?.isElectron);

  const [contentProtection, setContentProtection] = React.useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = React.useState(true);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [showSources, setShowSources] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [quickLine, setQuickLine] = React.useState('');
  const [nowTick, setNowTick] = React.useState(Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (!bridge) return;
    void bridge.getWindowState().then((s) => {
      setContentProtection(s.contentProtection);
      setAlwaysOnTop(s.alwaysOnTop);
    });
    return bridge.onWindowStateChange((s) => {
      setContentProtection(s.contentProtection);
      setAlwaysOnTop(s.alwaysOnTop);
    });
  }, [bridge]);

  const activeInsights = React.useMemo(
    () => (selectedMeeting ? selectedMeeting.insights.filter((i) => !i.dismissed) : []),
    [selectedMeeting],
  );

  const latestKey = activeInsights[0]
    ? `${activeInsights[0].id}:${activeInsights[0].evolutionCount || 1}:${activeInsights[0].objectionStatus}`
    : 'none';

  React.useEffect(() => {
    if (activeInsights.length > 0) {
      setActiveIndex(0);
      setShowSources(false);
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
      : matchedBattlecard?.theirWeaknesses?.slice(0, 3);

  const latestTurn = selectedMeeting?.transcript[selectedMeeting.transcript.length - 1];
  const latestQuickAnswer = selectedMeeting?.quickAnswers?.[0] || null;

  const elapsedSec = React.useMemo(() => {
    if (!selectedMeeting || selectedMeeting.status === 'created') return 0;
    const startMs = Date.parse(selectedMeeting.startedAt);
    if (!Number.isFinite(startMs)) return (selectedMeeting.durationMinutes || 0) * 60;
    const endMs =
      selectedMeeting.status === 'completed' && selectedMeeting.endedAt
        ? Date.parse(selectedMeeting.endedAt)
        : nowTick;
    return Math.max(0, Math.floor((endMs - startMs) / 1000));
  }, [selectedMeeting, nowTick]);

  const clockLabel = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(
    elapsedSec % 60,
  ).padStart(2, '0')}`;

  const handleCopy = (id: string, text: string) => {
    onCopyText(text, 'Counter-pitch copied');
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickLine.trim() || !selectedMeeting || analyzing) return;
    const prospectName = selectedMeeting.prospectStakeholders[0] || 'Prospect';
    onSendTurn('Prospect', prospectName, quickLine.trim());
    setQuickLine('');
  };

  const zoomStatus = selectedMeeting?.zoomLink?.status;

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col">
      {/* Draggable Native HUD Top Bar */}
      <header className="app-drag px-3 py-2 bg-[#090E1A] border-b border-slate-800 flex items-center justify-between gap-2 select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-[#4F46E5] flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">
              AI Sales Strategist · HUD
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  wsConnected ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span>{wsConnected ? 'Live Sync' : 'Reconnecting'}</span>
              <span>·</span>
              <span className="font-mono tabular-nums inline-flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {clockLabel}
              </span>
              {zoomStatus && zoomStatus !== 'disconnected' && (
                <>
                  <span>·</span>
                  <span className="text-emerald-300 font-medium">
                    Zoom {zoomStatus === 'in_call' ? 'Connected' : zoomStatus}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="app-no-drag flex items-center gap-1 shrink-0">
          {isElectron && bridge && (
            <>
              <button
                type="button"
                onClick={() => void bridge.setContentProtection(!contentProtection)}
                title={
                  contentProtection
                    ? 'Screen-Share Shield ON (hidden from Zoom share)'
                    : 'Screen-Share Shield OFF'
                }
                className={`p-1.5 rounded text-[10px] border transition-colors ${
                  contentProtection
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void bridge.setAlwaysOnTop(!alwaysOnTop)}
                title={alwaysOnTop ? 'Always on top ON' : 'Always on top OFF'}
                className={`p-1.5 rounded text-[10px] border transition-colors ${
                  alwaysOnTop
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() =>
              audioState.capturing ? onStopAudioCapture() : void onStartAudioCapture('dual')
            }
            title={
              audioState.capturing
                ? 'Stop live audio listening'
                : 'Start dual capture (Zoom tab/system audio + Mic)'
            }
            className={`px-2 py-1 rounded text-[11px] font-medium border inline-flex items-center gap-1 ${
              audioState.capturing
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            {audioState.capturing ? (
              <>
                <Square className="w-2.5 h-2.5" /> Stop
              </>
            ) : (
              <>
                <Mic className="w-3 h-3 text-emerald-400" /> Listen
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenZoomModal}
            title="Audio capture options & Desktop HUD settings"
            className="px-2 py-1 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1"
          >
            <Video className="w-3 h-3 text-indigo-400" />
          </button>

          {isElectron && bridge ? (
            <>
              <button
                type="button"
                onClick={() => void bridge.openFullWorkspace(window.location.origin)}
                title="Open full web workspace"
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void bridge.hideHud()}
                title="Hide HUD (Cmd/Ctrl+Shift+Space to bring back)"
                className="p-1.5 rounded bg-slate-800 hover:bg-rose-900/50 text-slate-300 border border-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onExitDesktopHud}
              className="px-2 py-1 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              Full App
            </button>
          )}
        </div>
      </header>

      {/* Active Meeting Selector Bar */}
      <div className="px-3 py-2 bg-[#111827] border-b border-slate-800 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <select
            aria-label="Select meeting session"
            value={selectedMeeting?.id || ''}
            onChange={(e) => onSelectMeeting(e.target.value)}
            className="flex-1 min-w-0 rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-100"
          >
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.accountName} ({m.primaryCompetitor})
              </option>
            ))}
          </select>
          {(analyzing || audioState.transcribingCount > 0) && (
            <span className="text-[11px] text-indigo-300 inline-flex items-center gap-1 shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              {audioState.transcribingCount > 0 ? 'Listening' : 'Analyzing'}
            </span>
          )}
        </div>

        {audioState.capturing && (
          <div className="flex items-center gap-3 text-[10px] text-slate-300">
            {audioState.tabActive && (
              <div className="flex items-center gap-1.5 flex-1">
                <MonitorSpeaker className="w-3 h-3 text-emerald-400 shrink-0" />
                <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-100"
                    style={{ width: `${audioState.tabLevel}%` }}
                  />
                </div>
              </div>
            )}
            {audioState.micActive && (
              <div className="flex items-center gap-1.5 flex-1">
                <Mic className="w-3 h-3 text-indigo-400 shrink-0" />
                <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 transition-all duration-100"
                    style={{ width: `${audioState.micLevel}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Floating Recommendation Card Body */}
      <main className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {copilotError && (
          <div className="rounded-md bg-rose-950/70 border border-rose-700/60 px-3 py-2 text-xs text-rose-200">
            {copilotError}
          </div>
        )}

        {latestQuickAnswer && (
          <div className="rounded-xl bg-white text-slate-900 shadow-xl border border-indigo-200 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="font-bold uppercase tracking-wide text-[#4338CA] truncate">
                Instant Answer · {(latestQuickAnswer.latencyMs / 1000).toFixed(1)}s
              </span>
              <button
                type="button"
                onClick={() => handleCopy(latestQuickAnswer.id, latestQuickAnswer.spokenAnswer)}
                className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium inline-flex items-center gap-1 shrink-0"
              >
                {copiedId === latestQuickAnswer.id ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Copy
                  </>
                )}
              </button>
            </div>
            <div className="text-xs font-bold text-slate-900 leading-snug">
              {latestQuickAnswer.headline}
            </div>
            <p className="text-xs text-slate-800 leading-relaxed">
              {latestQuickAnswer.spokenAnswer}
            </p>
            {latestQuickAnswer.keyBullets.length > 0 && (
              <ul className="space-y-0.5 text-[11px] text-slate-700 list-disc pl-4 leading-snug">
                {latestQuickAnswer.keyBullets.slice(0, 3).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!currentInsight && !latestQuickAnswer ? (
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 text-center space-y-2.5 mt-4">
            <Sparkles className="w-6 h-6 text-indigo-400 mx-auto" />
            <div className="text-sm font-semibold text-white">
              Waiting for Live Zoom Utterance
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              This floating HUD updates automatically the moment a prospect asks a question, raises a concern, or names a competitor on your Zoom call.
            </p>
            <button
              type="button"
              onClick={onOpenZoomModal}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#4F46E5] hover:bg-[#4338CA] text-white inline-flex items-center gap-1.5"
            >
              <Mic className="w-3.5 h-3.5" />
              Listen Live (Mic + Zoom Audio)
            </button>
          </div>
        ) : currentInsight ? (
          <div className="rounded-xl bg-white text-slate-900 shadow-xl border border-indigo-200 p-3.5 space-y-2.5">
            {(() => {
              const pill = statusPill(
                currentInsight.objectionStatus,
                currentInsight.evolutionCount || 1,
              );
              return (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-[#4338CA] truncate">
                      {currentInsight.competitorName
                        ? `Competitor · ${currentInsight.competitorName}`
                        : currentInsight.objectionCategory || currentInsight.category}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {activeInsights.length > 1 && (
                        <div className="flex items-center gap-0.5 text-[10px] font-mono text-slate-600">
                          <button
                            type="button"
                            onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                            disabled={activeIndex === 0}
                            className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-35"
                            aria-label="Previous recommendation"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
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
                            className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-35"
                            aria-label="Next recommendation"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 leading-snug">
                    {currentInsight.objectionDetected || currentInsight.title}
                  </h3>

                  {currentInsight.conversationBasis && (
                    <div className="text-[10px] font-mono text-slate-500">
                      {currentInsight.conversationBasis}
                    </div>
                  )}
                </div>
              );
            })()}

            {currentInsight.competitorName && weaknesses && weaknesses.length > 0 && (
              <div className="rounded-md bg-[#FFFBEB] border border-[#FDE68A] p-2.5 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#92400E] flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-amber-600" />
                  {currentInsight.competitorName} Weaknesses to Exploit
                </div>
                <ul className="space-y-0.5 text-[11px] text-amber-950 list-disc pl-4 leading-snug">
                  {weaknesses.slice(0, 3).map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {currentInsight.abstained && (
              <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] p-2 text-[11px] text-[#9F1239] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-[#E11D48] shrink-0 mt-0.5" />
                <span>
                  {currentInsight.limitations[0] ||
                    'No verified battlecard on file for this claim—use discovery questions.'}
                </span>
              </div>
            )}

            <div className="text-[11px] text-slate-700 leading-snug">
              <span className="font-semibold text-slate-900">Why they said this: </span>
              {currentInsight.underlyingConcern || currentInsight.interpretation}
            </div>

            <div className="rounded-md bg-[#EEF2FF]/80 border border-[#C7D2FE] p-2.5 space-y-1.5">
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

            {currentInsight.discoveryQuestion && (
              <div className="flex items-start gap-1.5 rounded-md bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-800">
                <Lightbulb className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-sky-800">Ask Next: </span>
                  {currentInsight.discoveryQuestion}
                </div>
              </div>
            )}

            <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
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

            {showSources && (
              <div className="space-y-1">
                {currentInsight.supportingSources.map((src, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-slate-200 bg-slate-50 p-2 text-[10px] space-y-0.5"
                  >
                    <div className="font-semibold text-slate-800">{src.title}</div>
                    {src.excerpt && <p className="text-slate-600 line-clamp-2">{src.excerpt}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </main>

      {/* Bottom Live Caption + Quick Utterance Fallback */}
      <footer className="px-3 py-2.5 bg-[#090E1A] border-t border-slate-800 space-y-2 shrink-0">
        {latestTurn && (
          <div className="text-[11px] leading-snug text-slate-300 truncate">
            <span className="font-semibold text-emerald-300 mr-1">
              {latestTurn.speaker === 'Sales Representative' || latestTurn.speaker === 'AE'
                ? 'Rep:'
                : `${latestTurn.speakerName}:`}
            </span>
            <span>&ldquo;{latestTurn.text}&rdquo;</span>
          </div>
        )}

        <form onSubmit={handleQuickSubmit} className="flex items-center gap-1.5">
          <input
            type="text"
            value={quickLine}
            onChange={(e) => setQuickLine(e.target.value)}
            placeholder="Quick prospect line fallback..."
            className="flex-1 rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={!quickLine.trim() || analyzing}
            className="px-2.5 py-1.5 rounded bg-[#4F46E5] hover:bg-[#4338CA] text-white text-xs font-medium inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Send className="w-3 h-3" />
          </button>
        </form>
      </footer>
    </div>
  );
};
