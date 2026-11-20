import React from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  FileAudio,
  Laptop,
  Loader2,
  Mic,
  MonitorSpeaker,
  Radio,
  Send,
  ShieldCheck,
  Square,
  Terminal,
  Upload,
  Video,
  Volume2,
  Webhook,
  X,
} from 'lucide-react';
import type { AudioCaptureMode, LiveAudioCaptureState } from '../hooks/useLiveAudioCapture';
import type { MeetingSession, SpeakerRole, ZoomLinkState } from '../types/sales';

interface ZoomStatusResponse {
  recallConfigured: boolean;
  recallRegion: string;
  webhookSecretConfigured: boolean;
  webhookUrl: string;
  desktopHudUrl: string;
  zoomLink: ZoomLinkState;
}

interface ZoomConnectModalProps {
  open: boolean;
  meeting: MeetingSession;
  apiHeaders: Record<string, string>;
  audioState: LiveAudioCaptureState;
  onStartAudioCapture: (mode: AudioCaptureMode) => Promise<boolean>;
  onStopAudioCapture: () => void;
  onSetMicSpeaker: (role: SpeakerRole) => void;
  onUploadAudioFile: (file: File, speaker: SpeakerRole) => Promise<boolean>;
  onSendTurn: (speaker: SpeakerRole, speakerName: string, text: string) => void;
  onClose: () => void;
  onCopyText: (text: string, label?: string) => void;
  onSwitchToDesktopHud: () => void;
}

export const ZoomConnectModal: React.FC<ZoomConnectModalProps> = ({
  open,
  meeting,
  apiHeaders,
  audioState,
  onStartAudioCapture,
  onStopAudioCapture,
  onSetMicSpeaker,
  onUploadAudioFile,
  onSendTurn,
  onClose,
  onCopyText,
  onSwitchToDesktopHud,
}) => {
  const [tab, setTab] = React.useState<'audio' | 'desktop' | 'webhook'>('audio');
  const [status, setStatus] = React.useState<ZoomStatusResponse | null>(null);
  const [testingWebhook, setTestingWebhook] = React.useState(false);
  const [infoMsg, setInfoMsg] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  // Zero-permission alternatives state
  const [uploadSpeaker, setUploadSpeaker] = React.useState<SpeakerRole>('Prospect');
  const [uploadingFile, setUploadingFile] = React.useState(false);
  const [captionSpeaker, setCaptionSpeaker] = React.useState<SpeakerRole>('Prospect');
  const [captionText, setCaptionText] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/integrations/zoom/status?meetingId=${encodeURIComponent(meeting.id)}`,
        { headers: apiHeaders },
      );
      if (res.ok) {
        const data = (await res.json()) as ZoomStatusResponse;
        setStatus(data);
      }
    } catch {
      // Ignore network poll error
    }
  }, [meeting.id, apiHeaders]);

  React.useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setInfoMsg(null);
      void fetchStatus();
    }
  }, [open, fetchStatus]);

  if (!open) return null;

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const standaloneUrl =
    typeof window !== 'undefined' ? window.location.href : originUrl;
  const webhookUrl =
    status?.webhookUrl ||
    `${originUrl}/api/integrations/zoom/webhook?meetingId=${encodeURIComponent(meeting.id)}`;
  const desktopHudUrl =
    status?.desktopHudUrl ||
    `${originUrl}/?mode=desktop-hud&meetingId=${encodeURIComponent(meeting.id)}`;
  const desktopRunCommand = `cd desktop && npm install && COPILOT_SERVER_URL="${originUrl}" npm start`;

  const handleCopy = (key: string, value: string, label: string) => {
    onCopyText(value, label);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1600);
  };

  const handleStartCapture = async (mode: AudioCaptureMode) => {
    setErrorMsg(null);
    setInfoMsg(null);
    const ok = await onStartAudioCapture(mode);
    if (ok) {
      setInfoMsg(
        mode === 'dual'
          ? 'Live audio listening started—check channel status below.'
          : mode === 'tab_only'
          ? 'Listening to shared Zoom tab / system audio as Prospect.'
          : mode === 'mic_prospect'
          ? 'Listening via Microphone (attributed to Prospect—ideal for Zoom speaker audio).'
          : 'Listening via Microphone (attributed to Sales Rep).',
      );
    }
  };

  const handleAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setUploadingFile(true);
    try {
      const ok = await onUploadAudioFile(file, uploadSpeaker);
      if (ok) {
        setInfoMsg(`Transcribed "${file.name}" as ${uploadSpeaker} and updated Live Copilot.`);
      } else {
        setErrorMsg('No recognizable speech was detected in that audio clip.');
      }
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSendCaption = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = captionText.trim();
    if (!cleaned) return;
    setErrorMsg(null);
    const speakerName =
      captionSpeaker === 'Sales Representative'
        ? `${meeting.aeName} (Sales Rep)`
        : meeting.prospectStakeholders[0] || 'Zoom Prospect';
    onSendTurn(captionSpeaker, speakerName, cleaned);
    setCaptionText('');
    setInfoMsg('Caption ingested into live transcript & AI Strategist.');
  };

  const handleTestWebhook = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setTestingWebhook(true);
    try {
      const res = await fetch('/api/integrations/zoom/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...apiHeaders },
        body: JSON.stringify({
          meetingId: meeting.id,
          speakerName: meeting.prospectStakeholders[0] || 'Samira Patel (Prospect)',
          text: 'We currently use BrowserStack and they offered a renewal discount.',
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMsg(data.error || 'Webhook test failed');
      } else {
        setInfoMsg(
          'Live webhook payload ingested! Watch your Copilot HUD / Recommendations update in real time.',
        );
      }
    } finally {
      setTestingWebhook(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F172A]/50">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl eki-drawer overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-[#0F172A] text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#4F46E5] flex items-center justify-center">
              <Radio className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold">
                Listen to Live Zoom Call (No Bot) &amp; Desktop HUD
              </h2>
              <p className="text-[11px] text-slate-300">
                Capture browser mic + shared Zoom tab/system audio privately—no external bot joins your call
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-navigation Tabs */}
        <div className="px-5 pt-3 border-b border-slate-200 bg-[#F8FAFC] flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('audio')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 inline-flex items-center gap-1.5 transition-colors ${
              tab === 'audio'
                ? 'border-[#4F46E5] text-[#4338CA]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            1. Live Audio &amp; Captions
          </button>
          <button
            type="button"
            onClick={() => setTab('desktop')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 inline-flex items-center gap-1.5 transition-colors ${
              tab === 'desktop'
                ? 'border-[#4F46E5] text-[#4338CA]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Laptop className="w-3.5 h-3.5" />
            2. Desktop HUD Wrapper (Electron)
          </button>
          <button
            type="button"
            onClick={() => setTab('webhook')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 inline-flex items-center gap-1.5 transition-colors ${
              tab === 'webhook'
                ? 'border-[#4F46E5] text-[#4338CA]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Webhook className="w-3.5 h-3.5" />
            3. Webhook API (Optional)
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[76vh] overflow-y-auto">
          {(errorMsg || audioState.error) && (
            <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] px-3 py-2.5 text-xs text-[#9F1239] space-y-2">
              <div>{errorMsg || audioState.error}</div>
              {audioState.isEmbeddedIframe && (
                <div>
                  <a
                    href={standaloneUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-semibold text-[#9F1239] underline hover:text-rose-900"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open App in Standalone Browser Tab (Unlocks Mic &amp; Zoom Tab Audio)
                  </a>
                </div>
              )}
            </div>
          )}

          {audioState.notice && (
            <div className="rounded-md bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2 text-xs text-[#92400E] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{audioState.notice}</span>
            </div>
          )}

          {infoMsg && (
            <div className="rounded-md bg-[#ECFDF5] border border-[#A7F3D0] px-3 py-2 text-xs text-[#065F46]">
              {infoMsg}
            </div>
          )}

          {tab === 'audio' && (
            <>
              {/* Embedded Iframe Permission Helper */}
              {audioState.isEmbeddedIframe ? (
                <div className="rounded-lg border border-amber-200 bg-[#FFFBEB]/80 p-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-[240px]">
                    <div className="text-xs font-semibold text-[#92400E]">
                      Running inside embedded preview — browser blocks Tab Audio here
                    </div>
                    <p className="text-[11px] text-amber-900/90 leading-relaxed">
                      Browsers enforce a security policy that blocks <strong>Share tab/system audio</strong> inside iframes. Open in a standalone tab for native Zoom tab capture, or use <strong>Room/Speaker Mic</strong> or the <strong>Zero-Permission</strong> options below right now.
                    </p>
                  </div>
                  <a
                    href={standaloneUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Standalone Tab
                  </a>
                </div>
              ) : (
                <div className="rounded-lg border border-indigo-200 bg-[#EEF2FF]/60 p-3.5 space-y-1">
                  <div className="text-xs font-semibold text-[#312E81]">
                    Private Dual-Channel Listening Ready
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    <strong>Shared Zoom tab / system audio</strong> transcribes as <strong>Prospect</strong>, and your <strong>microphone</strong> transcribes as <strong>Sales Rep</strong>—no bot joins the call. When prompted, select your Zoom tab/screen and check <strong>&ldquo;Share tab audio&rdquo;</strong> / <strong>&ldquo;Share system audio&rdquo;</strong>.
                  </p>
                </div>
              )}

              {/* Live Channel Meters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 inline-flex items-center gap-1.5">
                      <MonitorSpeaker className="w-3.5 h-3.5 text-emerald-600" />
                      Zoom Tab / System Audio
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {audioState.tabActive ? 'Prospect · Active' : 'Idle'}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-100"
                      style={{ width: `${audioState.tabLevel}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 inline-flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-[#4F46E5]" />
                      Microphone
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {audioState.micActive
                        ? `${audioState.micSpeaker === 'Prospect' ? 'Prospect' : 'Sales Rep'} · Active`
                        : 'Idle'}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-[#4F46E5] transition-all duration-100"
                      style={{ width: `${audioState.micLevel}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Capture Action Controls */}
              {audioState.capturing ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Listening Live &amp; Streaming to Groq Whisper
                        {audioState.transcribingCount > 0 && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                        )}
                      </div>
                      {audioState.lastTranscribedLine ? (
                        <div className="text-[11px] text-emerald-800">
                          Last captured ({audioState.lastTranscribedLine.speaker}): &ldquo;
                          {audioState.lastTranscribedLine.text}&rdquo;
                        </div>
                      ) : (
                        <div className="text-[11px] text-emerald-800">
                          Speak or play Zoom call audio—turns transcribe automatically when a phrase pauses.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={onStopAudioCapture}
                      className="px-3.5 py-2 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center gap-1.5"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Stop Listening
                    </button>
                  </div>

                  {audioState.micActive && !audioState.tabActive && (
                    <div className="pt-2 border-t border-emerald-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-emerald-900 font-medium">
                        Attribute microphone speech to:
                      </span>
                      <div className="flex items-center p-0.5 bg-white border border-emerald-200 rounded-md">
                        {(['Prospect', 'Sales Representative'] as const).map((role) => (
                          <button
                            key={role}
                            type="button"
                            onClick={() => onSetMicSpeaker(role)}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                              audioState.micSpeaker === role
                                ? 'bg-emerald-600 text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {role === 'Prospect' ? 'Prospect (Speaker Audio)' : 'Sales Rep (You)'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleStartCapture('dual')}
                    className="eki-btn-primary px-3.5 py-2 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Video className="w-3.5 h-3.5" />
                    Dual Capture (Tab + Mic)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStartCapture('mic_prospect')}
                    className="eki-btn-secondary px-3 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                    title="Capture Zoom speaker audio via your microphone as Prospect (works inside iframes)"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                    Room / Speaker Mic (Prospect)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStartCapture('mic_only')}
                    className="eki-btn-secondary px-3 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Mic className="w-3.5 h-3.5 text-[#4F46E5]" />
                    Mic Only (Rep)
                  </button>
                  {!audioState.isEmbeddedIframe && (
                    <button
                      type="button"
                      onClick={() => void handleStartCapture('tab_only')}
                      className="eki-btn-secondary px-3 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <MonitorSpeaker className="w-3.5 h-3.5 text-emerald-600" />
                      Zoom Audio Only
                    </button>
                  )}
                </div>
              )}

              {/* Zero-Permission Alternatives (Works without Mic or Screen Share) */}
              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-900">
                    No-Permission Alternatives (Instant — No Browser Prompt)
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Works even when mic &amp; tab audio are blocked
                  </span>
                </div>

                {/* 1. Audio Clip Upload -> Groq Whisper */}
                <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileAudio className="w-4 h-4 text-[#4F46E5] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800">
                        Transcribe Audio Clip (Groq Whisper)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Upload any .mp3, .wav, .m4a, or .webm clip to analyze live
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      aria-label="Audio clip speaker"
                      value={uploadSpeaker}
                      onChange={(e) => setUploadSpeaker(e.target.value as SpeakerRole)}
                      className="eki-input rounded-md px-2 py-1 text-[11px] text-slate-800"
                    >
                      <option value="Prospect">Prospect</option>
                      <option value="Sales Representative">Sales Rep</option>
                    </select>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                      onChange={(e) => void handleAudioFileChange(e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingFile}
                      onClick={() => fileInputRef.current?.click()}
                      className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    >
                      {uploadingFile ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Transcribing...
                        </>
                      ) : (
                        <>
                          <Upload className="w-3.5 h-3.5" />
                          Upload Audio
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 2. Live Caption / Transcript Feed */}
                <form
                  onSubmit={handleSendCaption}
                  className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Paste Zoom Live Caption / Utterance
                    </span>
                    <div className="flex items-center p-0.5 bg-slate-200/70 rounded-md">
                      {(['Prospect', 'Sales Representative'] as const).map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setCaptionSpeaker(role)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                            captionSpeaker === role
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {role === 'Prospect' ? 'Prospect' : 'Sales Rep'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={captionText}
                      onChange={(e) => setCaptionText(e.target.value)}
                      placeholder="Paste what the prospect just said (e.g. from Zoom Live Captions)..."
                      className="eki-input flex-1 rounded-md px-2.5 py-1.5 text-xs bg-white"
                    />
                    <button
                      type="submit"
                      disabled={!captionText.trim()}
                      className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
                    >
                      <Send className="w-3 h-3" />
                      Analyze
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}

          {tab === 'desktop' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-indigo-200 bg-[#EEF2FF]/60 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#312E81]">
                    <ShieldCheck className="w-4 h-4 text-[#4F46E5]" />
                    Always-On-Top Floating HUD + Screen-Share Shield
                  </div>
                  <span className="text-[10px] font-mono text-[#4338CA] bg-white border border-indigo-200 px-2 py-0.5 rounded">
                    /desktop (Electron)
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  The Electron desktop wrapper runs outside browser iframe restrictions—giving full system loopback audio + mic capture directly from the compact floating HUD, hiding itself during screen shares (<code className="font-mono">contentProtection</code>), and toggling with{' '}
                  <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono">
                    Cmd/Ctrl+Shift+Space
                  </kbd>.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 p-3.5 space-y-2.5">
                <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-slate-600" />
                  Launch Desktop Wrapper Connected to This Server
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-slate-900 text-slate-100 px-3 py-2 text-[11px] font-mono overflow-x-auto whitespace-nowrap">
                    {desktopRunCommand}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy('cmd', desktopRunCommand, 'Desktop launch command copied')
                    }
                    className="eki-btn-secondary px-2.5 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1 shrink-0"
                  >
                    {copiedKey === 'cmd' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    Corner HUD Overlay &amp; Electron Endpoint
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate max-w-md">
                    {desktopHudUrl}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSwitchToDesktopHud();
                    }}
                    className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium"
                  >
                    Show Corner HUD
                  </button>
                  <a
                    href={`/?mode=desktop-hud&meetingId=${encodeURIComponent(meeting.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    New Tab
                  </a>
                </div>
              </div>
            </div>
          )}

          {tab === 'webhook' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">
                  External Transcript Webhook (Optional)
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  {status?.webhookSecretConfigured ? 'HMAC Verified' : 'Open'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-white border border-slate-200 px-2.5 py-1.5 text-[11px] font-mono text-slate-800 overflow-x-auto whitespace-nowrap">
                  POST {webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy('webhook', webhookUrl, 'Webhook URL copied')}
                  className="eki-btn-secondary px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 shrink-0"
                >
                  {copiedKey === 'webhook' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-[11px] text-slate-600">
                  If you later stream external captions via webhook, push JSON here without any bot or browser permissions.
                </p>
                <button
                  type="button"
                  onClick={handleTestWebhook}
                  disabled={testingWebhook}
                  className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5"
                >
                  {testingWebhook ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Webhook className="w-3.5 h-3.5 text-[#4F46E5]" />
                  )}
                  Send Test Webhook
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
