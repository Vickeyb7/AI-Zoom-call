import React from 'react';
import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpLeft,
  ArrowUpRight,
  Check,
  Copy,
  EyeOff,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  Square,
  X,
  Zap,
} from 'lucide-react';
import type { AudioCaptureMode, LiveAudioCaptureState } from '../hooks/useLiveAudioCapture';
import type {
  Battlecard,
  DisplayDensity,
  FeedbackRating,
  MeetingSession,
  QuickAnswerSpeed,
  QuickAnswerStyle,
} from '../types/sales';

export type HudCorner = 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left';

interface CornerCopilotHudProps {
  open: boolean;
  meeting: MeetingSession | null;
  battlecards: Battlecard[];
  analyzing: boolean;
  quickAnswering?: boolean;
  audioState: LiveAudioCaptureState;
  onStartAudioCapture: (mode: AudioCaptureMode) => Promise<boolean>;
  onStopAudioCapture: () => void;
  onRequestQuickAnswer?: (params: {
    question?: string;
    style: QuickAnswerStyle;
    speed: QuickAnswerSpeed;
  }) => Promise<void>;
  onInsightAction: (insightId: string, action: 'apply' | 'dismiss') => void;
  onInsightFeedback: (insightId: string, rating: FeedbackRating) => void;
  onCopyText: (text: string, label?: string) => void;
  onOpenAudioSettings: () => void;
  onClose: () => void;
  density?: DisplayDensity;
  onChangeDensity?: (density: DisplayDensity) => void;
}

const CORNER_CLASSES: Record<HudCorner, string> = {
  'bottom-right': 'bottom-4 right-4',
  'top-right': 'top-20 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-left': 'top-20 left-4',
};

const CORNER_ORDER: HudCorner[] = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];

function CornerIcon({ corner }: { corner: HudCorner }) {
  if (corner === 'bottom-right') return <ArrowDownRight className="w-3.5 h-3.5" />;
  if (corner === 'top-right') return <ArrowUpRight className="w-3.5 h-3.5" />;
  if (corner === 'bottom-left') return <ArrowDownLeft className="w-3.5 h-3.5" />;
  return <ArrowUpLeft className="w-3.5 h-3.5" />;
}

export const CornerCopilotHud: React.FC<CornerCopilotHudProps> = ({
  open,
  meeting,
  analyzing,
  quickAnswering = false,
  audioState,
  onStartAudioCapture,
  onStopAudioCapture,
  onRequestQuickAnswer,
  onCopyText,
  onOpenAudioSettings,
  onClose,
}) => {
  const [corner, setCorner] = React.useState<HudCorner>('bottom-right');
  const [minimized, setMinimized] = React.useState(false);
  const [stealthHidden, setStealthHidden] = React.useState(false);
  const [opacity, setOpacity] = React.useState<number>(92);
  const [style, setStyle] = React.useState<QuickAnswerStyle>('concise');
  const [copied, setCopied] = React.useState(false);

  // Alt+H toggles stealth hide while HUD is open
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setStealthHidden((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  const latestAnswer = meeting?.quickAnswers?.[0] || null;
  const latestInsight = meeting?.insights.find((i) => !i.dismissed) || null;
  const latestOtherTurn = meeting
    ? [...meeting.transcript]
        .reverse()
        .find((t) => t.speaker !== 'Sales Representative' && t.speaker !== 'AE') ||
      meeting.transcript[meeting.transcript.length - 1]
    : null;

  const cycleCorner = () => {
    const idx = CORNER_ORDER.indexOf(corner);
    setCorner(CORNER_ORDER[(idx + 1) % CORNER_ORDER.length]);
  };

  const handleCopyCurrent = () => {
    const text =
      latestAnswer?.spokenAnswer ||
      latestInsight?.suggestedResponse ||
      latestInsight?.recommendedApproach ||
      '';
    if (!text) return;
    onCopyText(text, 'Copied from Stealth HUD');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (stealthHidden) {
    return (
      <button
        type="button"
        onClick={() => setStealthHidden(false)}
        title="Restore Stealth Overlay (Alt+H)"
        className={`fixed ${CORNER_CLASSES[corner]} z-40 px-2.5 py-1.5 rounded-md bg-[#0B1120]/70 hover:bg-[#0B1120] text-slate-300 text-[11px] font-medium border border-slate-700/70 transition-opacity`}
      >
        Show HUD (Alt+H)
      </button>
    );
  }

  if (minimized) {
    return (
      <div
        style={{ opacity: opacity / 100 }}
        className={`fixed ${CORNER_CLASSES[corner]} z-40 rounded-lg bg-[#0B1120] text-white shadow-xl border border-slate-700/90 px-3 py-2 flex items-center gap-2.5`}
      >
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 text-xs font-medium hover:text-indigo-200 whitespace-nowrap"
        >
          <span>Stealth Copilot</span>
          {audioState.capturing && (
            <span className="text-[11px] text-emerald-400 font-medium">· Listening</span>
          )}
        </button>
        {onRequestQuickAnswer && (
          <button
            type="button"
            disabled={quickAnswering}
            onClick={() => {
              setMinimized(false);
              void onRequestQuickAnswer({ style, speed: 'fast' });
            }}
            className="px-2 py-1 rounded bg-[#4F46E5] hover:bg-[#4338CA] text-white text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
          >
            <Zap className="w-3 h-3" />
            Answer
          </button>
        )}
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Expand Stealth HUD"
          className="p-1 rounded hover:bg-slate-800 text-slate-300"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Stealth HUD"
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Stealth Copilot Overlay"
      style={{ opacity: opacity / 100 }}
      className={`fixed ${CORNER_CLASSES[corner]} z-40 w-[390px] max-w-[calc(100vw-24px)] rounded-xl bg-[#0B1120] text-slate-100 shadow-2xl border border-slate-700/90 overflow-hidden backdrop-blur-md`}
    >
      {/* Stealth Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-white truncate">Stealth Copilot</span>
          {(quickAnswering || analyzing || audioState.transcribingCount > 0) && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() =>
              audioState.capturing ? onStopAudioCapture() : void onStartAudioCapture('dual')
            }
            className={`px-2 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap ${
              audioState.capturing
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
            title={audioState.capturing ? 'Stop listening' : 'Listen to call audio + mic'}
          >
            {audioState.capturing ? (
              <>
                <Square className="w-2.5 h-2.5" /> Live
              </>
            ) : (
              <>
                <Mic className="w-3 h-3 text-emerald-400" /> Listen
              </>
            )}
          </button>

          <button
            type="button"
            onClick={cycleCorner}
            title="Move overlay corner"
            className="p-1 rounded hover:bg-slate-800 text-slate-300"
          >
            <CornerIcon corner={corner} />
          </button>
          <button
            type="button"
            onClick={() => setStealthHidden(true)}
            title="Quick hide (Alt+H)"
            className="p-1 rounded hover:bg-slate-800 text-slate-300"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            aria-label="Minimize Stealth HUD"
            className="p-1 rounded hover:bg-slate-800 text-slate-300"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Stealth HUD"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Action Bar inside Overlay */}
      <div className="px-3.5 py-2 border-b border-slate-800/80 flex items-center justify-between gap-2 bg-[#0F172A]">
        <div className="flex items-center gap-1">
          {(['concise', 'star', 'technical'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(s)}
              className={`px-2 py-1 rounded text-[11px] font-medium capitalize transition-colors ${
                style === s
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'star' ? 'STAR' : s === 'technical' ? 'Tech' : 'Concise'}
            </button>
          ))}
        </div>

        {onRequestQuickAnswer && (
          <button
            type="button"
            disabled={quickAnswering}
            onClick={() => void onRequestQuickAnswer({ style, speed: 'fast' })}
            className="px-2.5 py-1 rounded bg-[#4F46E5] hover:bg-[#4338CA] text-white text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-60"
          >
            <Zap className="w-3 h-3" />
            {quickAnswering ? 'Drafting...' : 'Answer Now'}
          </button>
        )}
      </div>

      {/* Scrollable Teleprompter Body */}
      <div className="p-3.5 space-y-3 max-h-[340px] overflow-y-auto">
        {latestOtherTurn && (
          <div className="text-[11px] text-slate-400 leading-snug pb-2 border-b border-slate-800">
            <span className="font-medium text-slate-300">Heard: </span>
            &ldquo;{latestOtherTurn.text}&rdquo;
          </div>
        )}

        {latestAnswer ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="font-semibold text-indigo-300 truncate">
                {latestAnswer.headline}
              </span>
              <span className="font-mono tabular-nums shrink-0">
                {(latestAnswer.latencyMs / 1000).toFixed(1)}s
              </span>
            </div>

            <p className="text-[13px] text-white leading-relaxed tracking-[0.01em]">
              {latestAnswer.spokenAnswer}
            </p>

            {latestAnswer.keyBullets.length > 0 && (
              <ul className="space-y-1 text-[12px] text-slate-200 list-disc pl-4 leading-snug">
                {latestAnswer.keyBullets.slice(0, 4).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}

            {latestAnswer.codeSnippet && (
              <pre className="p-2.5 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-indigo-200 overflow-x-auto">
                <code>{latestAnswer.codeSnippet}</code>
              </pre>
            )}
          </div>
        ) : latestInsight ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-indigo-300">
              {latestInsight.objectionDetected || latestInsight.title}
            </div>
            <p className="text-[13px] text-white leading-relaxed">
              {latestInsight.suggestedResponse || latestInsight.recommendedApproach}
            </p>
          </div>
        ) : (
          <div className="py-4 text-center space-y-2.5">
            <p className="text-xs text-slate-300 leading-relaxed">
              Click <strong className="text-white">Listen</strong> to capture call audio privately, or press <strong className="text-white">Answer Now</strong> anytime.
            </p>
            <button
              type="button"
              onClick={onOpenAudioSettings}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200"
            >
              Audio Setup
            </button>
          </div>
        )}
      </div>

      {/* Footer: Transparency Slider + Copy */}
      <div className="px-3.5 py-2 border-t border-slate-800 bg-[#0F172A] flex items-center justify-between gap-3 text-[11px] text-slate-400">
        <label className="flex items-center gap-2">
          <span>Opacity</span>
          <input
            type="range"
            min={55}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-20 accent-indigo-500 cursor-pointer"
          />
          <span className="font-mono tabular-nums w-8">{opacity}%</span>
        </label>

        {(latestAnswer || latestInsight) && (
          <button
            type="button"
            onClick={handleCopyCurrent}
            className="text-slate-200 hover:text-white inline-flex items-center gap-1 font-medium whitespace-nowrap"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> Copy
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
};
