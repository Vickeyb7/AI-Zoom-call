import React from 'react';
import type { SpeakerRole } from '../types/sales';

export type AudioCaptureMode = 'dual' | 'tab_only' | 'mic_only' | 'mic_prospect';

export interface LiveAudioCaptureState {
  capturing: boolean;
  mode: AudioCaptureMode | null;
  tabActive: boolean;
  micActive: boolean;
  micSpeaker: SpeakerRole;
  tabLevel: number; // 0-100
  micLevel: number; // 0-100
  transcribingCount: number;
  lastTranscribedLine: { speaker: SpeakerRole; text: string; at: string } | null;
  isEmbeddedIframe: boolean;
  notice: string | null;
  error: string | null;
}

interface UseLiveAudioCaptureOptions {
  meetingId: string;
  prospectName: string;
  repName: string;
  apiHeaders: Record<string, string>;
  onError?: (message: string) => void;
}

interface ChannelMonitor {
  label: string;
  speaker: SpeakerRole;
  speakerName: string;
  stream: MediaStream;
  audioCtx: AudioContext;
  analyser: AnalyserNode;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  isSpeaking: boolean;
  speechStartedAt: number;
  lastVoiceAt: number;
  stopped: boolean;
  rafId: number | null;
}

const SPEECH_THRESHOLD = 0.018;
const SILENCE_HOLD_MS = 950;
const MAX_SEGMENT_MS = 8500;
const MIN_SPEECH_MS = 550;

function detectEmbeddedIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isDisplayCapturePolicyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    err.name === 'NotAllowedError' ||
    err.name === 'SecurityError' ||
    msg.includes('display-capture') ||
    msg.includes('permissions policy') ||
    msg.includes('permission denied')
  );
}

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function useLiveAudioCapture({
  meetingId,
  prospectName,
  repName,
  apiHeaders,
  onError,
}: UseLiveAudioCaptureOptions) {
  const [state, setState] = React.useState<LiveAudioCaptureState>(() => ({
    capturing: false,
    mode: null,
    tabActive: false,
    micActive: false,
    micSpeaker: 'Sales Representative',
    tabLevel: 0,
    micLevel: 0,
    transcribingCount: 0,
    lastTranscribedLine: null,
    isEmbeddedIframe: detectEmbeddedIframe(),
    notice: null,
    error: null,
  }));

  const channelsRef = React.useRef<{ tab?: ChannelMonitor; mic?: ChannelMonitor }>({});
  const meetingIdRef = React.useRef(meetingId);
  const apiHeadersRef = React.useRef(apiHeaders);
  const prospectNameRef = React.useRef(prospectName);
  const repNameRef = React.useRef(repName);
  const micSpeakerRef = React.useRef<SpeakerRole>('Sales Representative');

  React.useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);
  React.useEffect(() => {
    apiHeadersRef.current = apiHeaders;
  }, [apiHeaders]);
  React.useEffect(() => {
    prospectNameRef.current = prospectName;
  }, [prospectName]);
  React.useEffect(() => {
    repNameRef.current = repName;
  }, [repName]);

  const setMicSpeaker = React.useCallback((role: SpeakerRole) => {
    micSpeakerRef.current = role;
    setState((prev) => ({ ...prev, micSpeaker: role }));
  }, []);

  const uploadAudioBlob = React.useCallback(
    async (blob: Blob, speaker: SpeakerRole, speakerName: string, fileName?: string) => {
      if (blob.size < 1800) return false; // Ignore tiny empty headers
      setState((prev) => ({ ...prev, transcribingCount: prev.transcribingCount + 1, error: null }));
      try {
        const ext = blob.type.includes('mp4')
          ? 'mp4'
          : blob.type.includes('mpeg') || blob.type.includes('mp3')
          ? 'mp3'
          : blob.type.includes('wav')
          ? 'wav'
          : blob.type.includes('ogg')
          ? 'ogg'
          : 'webm';
        const formData = new FormData();
        formData.append('audio', blob, fileName || `segment-${Date.now()}.${ext}`);
        formData.append('meetingId', meetingIdRef.current);
        formData.append('speaker', speaker);
        formData.append('speakerName', speakerName);

        const res = await fetch('/api/audio/transcribe', {
          method: 'POST',
          headers: apiHeadersRef.current,
          body: formData,
        });
        const data = (await res.json()) as {
          transcribed?: boolean;
          text?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Live audio transcription failed');
        }
        if (data.transcribed && data.text) {
          setState((prev) => ({
            ...prev,
            lastTranscribedLine: {
              speaker,
              text: data.text!,
              at: new Date().toTimeString().slice(0, 8),
            },
          }));
          return true;
        }
        return false;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transcription error';
        setState((prev) => ({ ...prev, error: msg }));
        onError?.(msg);
        return false;
      } finally {
        setState((prev) => ({
          ...prev,
          transcribingCount: Math.max(0, prev.transcribingCount - 1),
        }));
      }
    },
    [onError],
  );

  const uploadAudioFile = React.useCallback(
    async (file: File, speaker: SpeakerRole) => {
      const resolvedName =
        speaker === 'Sales Representative' ? repNameRef.current : prospectNameRef.current;
      return uploadAudioBlob(file, speaker, resolvedName, file.name);
    },
    [uploadAudioBlob],
  );

  const startChannelMonitor = React.useCallback(
    (
      key: 'tab' | 'mic',
      stream: MediaStream,
      speaker: SpeakerRole,
      speakerName: string,
      onTrackEnded: () => void,
    ): ChannelMonitor => {
      const audioOnlyStream = new MediaStream(stream.getAudioTracks());
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(audioOnlyStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const mimeType = pickSupportedMimeType();
      const monitor: ChannelMonitor = {
        label: key,
        speaker,
        speakerName,
        stream,
        audioCtx,
        analyser,
        recorder: null,
        chunks: [],
        isSpeaking: false,
        speechStartedAt: 0,
        lastVoiceAt: 0,
        stopped: false,
        rafId: null,
      };

      const startNewRecorder = () => {
        if (monitor.stopped) return;
        monitor.chunks = [];
        const rec = mimeType
          ? new MediaRecorder(audioOnlyStream, { mimeType })
          : new MediaRecorder(audioOnlyStream);
        monitor.recorder = rec;
        rec.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            monitor.chunks.push(ev.data);
          }
        };
        rec.onstop = () => {
          const hadValidSpeech =
            monitor.isSpeaking &&
            monitor.lastVoiceAt - monitor.speechStartedAt >= MIN_SPEECH_MS;
          const recordedBlob = new Blob(monitor.chunks, {
            type: rec.mimeType || mimeType || 'audio/webm',
          });
          monitor.chunks = [];
          monitor.isSpeaking = false;
          monitor.speechStartedAt = 0;

          if (hadValidSpeech && recordedBlob.size > 1800) {
            const activeSpeaker: SpeakerRole = key === 'mic' ? micSpeakerRef.current : speaker;
            const resolvedName =
              activeSpeaker === 'Sales Representative'
                ? repNameRef.current
                : prospectNameRef.current;
            void uploadAudioBlob(recordedBlob, activeSpeaker, resolvedName);
          }
          if (!monitor.stopped) {
            startNewRecorder();
          }
        };
        rec.start(250);
      };

      startNewRecorder();

      const dataArray = new Float32Array(analyser.fftSize);
      const poll = () => {
        if (monitor.stopped) return;
        analyser.getFloatTimeDomainData(dataArray);
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sumSq += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSq / dataArray.length);
        const levelPct = Math.min(100, Math.round(rms * 420));

        setState((prev) =>
          key === 'tab'
            ? prev.tabLevel === levelPct
              ? prev
              : { ...prev, tabLevel: levelPct }
            : prev.micLevel === levelPct
            ? prev
            : { ...prev, micLevel: levelPct },
        );

        const now = Date.now();
        if (rms >= SPEECH_THRESHOLD) {
          if (!monitor.isSpeaking) {
            monitor.isSpeaking = true;
            monitor.speechStartedAt = now;
          }
          monitor.lastVoiceAt = now;
        }

        const activeDuration = monitor.isSpeaking ? now - monitor.speechStartedAt : 0;
        const silenceDuration = monitor.isSpeaking ? now - monitor.lastVoiceAt : 0;

        if (
          monitor.isSpeaking &&
          monitor.recorder &&
          monitor.recorder.state === 'recording' &&
          ((silenceDuration >= SILENCE_HOLD_MS && activeDuration >= MIN_SPEECH_MS) ||
            activeDuration >= MAX_SEGMENT_MS)
        ) {
          monitor.recorder.stop();
        } else if (
          !monitor.isSpeaking &&
          monitor.recorder &&
          monitor.recorder.state === 'recording' &&
          monitor.chunks.length > 24
        ) {
          // Periodically recycle idle silent buffer so chunks stay crisp and headers stay fresh
          monitor.recorder.stop();
        }

        monitor.rafId = window.setTimeout(poll, 120);
      };

      monitor.rafId = window.setTimeout(poll, 120);

      for (const track of stream.getTracks()) {
        track.onended = () => {
          onTrackEnded();
        };
      }

      return monitor;
    },
    [uploadAudioBlob],
  );

  const stopChannel = (monitor?: ChannelMonitor) => {
    if (!monitor) return;
    monitor.stopped = true;
    if (monitor.rafId !== null) {
      window.clearTimeout(monitor.rafId);
      monitor.rafId = null;
    }
    try {
      if (monitor.recorder && monitor.recorder.state !== 'inactive') {
        monitor.recorder.stop();
      }
    } catch {
      // Ignore already-stopped MediaRecorder
    }
    for (const track of monitor.stream.getTracks()) {
      track.stop();
    }
    void monitor.audioCtx.close().catch(() => undefined);
  };

  const stopCapture = React.useCallback(() => {
    stopChannel(channelsRef.current.tab);
    stopChannel(channelsRef.current.mic);
    channelsRef.current = {};
    setState((prev) => ({
      ...prev,
      capturing: false,
      mode: null,
      tabActive: false,
      micActive: false,
      tabLevel: 0,
      micLevel: 0,
      notice: null,
    }));
  }, []);

  const startCapture = React.useCallback(
    async (mode: AudioCaptureMode) => {
      stopCapture();
      const inIframe = detectEmbeddedIframe();
      setState((prev) => ({ ...prev, error: null, notice: null, isEmbeddedIframe: inIframe }));

      if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
        const msg =
          'Browser media capture APIs are unavailable here. Open the app in a standalone HTTPS tab or use Audio Upload / Live Caption input instead.';
        setState((prev) => ({ ...prev, error: msg }));
        onError?.(msg);
        return false;
      }

      let tabStream: MediaStream | undefined;
      let micStream: MediaStream | undefined;
      let fallbackNotice: string | null = null;
      let effectiveMode: AudioCaptureMode = mode;

      try {
        if (mode === 'dual' || mode === 'tab_only') {
          if (!navigator.mediaDevices.getDisplayMedia) {
            if (mode === 'tab_only') {
              throw new Error(
                'Tab/system audio sharing (getDisplayMedia) is not supported in this browser.',
              );
            }
            fallbackNotice =
              'Tab/system audio sharing is not supported in this browser—switched to Microphone listening.';
          } else {
            try {
              tabStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                } as MediaTrackConstraints,
              });
              // Stop video track immediately; we only capture shared tab/system audio
              for (const vTrack of tabStream.getVideoTracks()) {
                vTrack.stop();
                tabStream.removeTrack(vTrack);
              }
              if (tabStream.getAudioTracks().length === 0) {
                for (const t of tabStream.getTracks()) t.stop();
                tabStream = undefined;
                if (mode === 'tab_only') {
                  throw new Error(
                    'No audio track was shared. In the picker, select your Zoom tab or screen and check "Share tab audio" / "Share system audio".',
                  );
                }
                fallbackNotice =
                  'No shared tab audio track was selected—continuing with Microphone listening.';
              }
            } catch (displayErr) {
              if (mode === 'tab_only') {
                if (inIframe && isDisplayCapturePolicyError(displayErr)) {
                  throw new Error(
                    'Embedded preview frames block "Share tab/system audio" by browser security policy. Click "Open in New Tab" to capture Zoom tab audio, or use Microphone / Audio Upload here.',
                  );
                }
                throw displayErr;
              }
              // In dual mode, gracefully fall back to microphone instead of failing the whole capture
              fallbackNotice = inIframe
                ? 'Tab/system audio sharing is blocked inside the embedded preview iframe—switched to Microphone listening automatically. Open the app in a standalone browser tab to enable Zoom tab audio.'
                : 'Tab/system audio prompt was dismissed—continuing with Microphone listening.';
            }
          }
        }

        if (mode === 'dual' || mode === 'mic_only' || mode === 'mic_prospect') {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: mode !== 'mic_prospect',
                noiseSuppression: mode !== 'mic_prospect',
                autoGainControl: true,
              },
            });
          } catch (micErr) {
            if (!tabStream) {
              throw micErr;
            }
            // Tab stream succeeded even though mic failed — continue with tab-only listening
            fallbackNotice =
              'Microphone permission was denied—continuing with shared Zoom Tab / System Audio only.';
            effectiveMode = 'tab_only';
          }
        }

        if (!tabStream && !micStream) {
          throw new Error(
            inIframe
              ? 'Browser blocked live capture inside the preview iframe. Open in a standalone tab for mic/tab audio, or upload an audio clip / paste live captions below.'
              : 'No audio source was granted. Allow microphone access or share tab audio to listen live.',
          );
        }

        const resolvedMicSpeaker: SpeakerRole =
          mode === 'mic_prospect' || (!tabStream && mode === 'dual')
            ? 'Prospect'
            : 'Sales Representative';
        micSpeakerRef.current = resolvedMicSpeaker;
        if (!tabStream && mode === 'dual') {
          effectiveMode = 'mic_prospect';
        }

        if (tabStream) {
          channelsRef.current.tab = startChannelMonitor(
            'tab',
            tabStream,
            'Prospect',
            prospectNameRef.current,
            () => {
              stopChannel(channelsRef.current.tab);
              channelsRef.current.tab = undefined;
              setState((prev) => ({
                ...prev,
                tabActive: false,
                tabLevel: 0,
                capturing: Boolean(channelsRef.current.mic),
              }));
            },
          );
        }

        if (micStream) {
          channelsRef.current.mic = startChannelMonitor(
            'mic',
            micStream,
            resolvedMicSpeaker,
            resolvedMicSpeaker === 'Prospect' ? prospectNameRef.current : repNameRef.current,
            () => {
              stopChannel(channelsRef.current.mic);
              channelsRef.current.mic = undefined;
              setState((prev) => ({
                ...prev,
                micActive: false,
                micLevel: 0,
                capturing: Boolean(channelsRef.current.tab),
              }));
            },
          );
        }

        setState((prev) => ({
          ...prev,
          capturing: true,
          mode: effectiveMode,
          tabActive: Boolean(tabStream),
          micActive: Boolean(micStream),
          micSpeaker: resolvedMicSpeaker,
          notice: fallbackNotice,
          error: null,
        }));
        return true;
      } catch (err) {
        if (tabStream) {
          for (const t of tabStream.getTracks()) t.stop();
        }
        if (micStream) {
          for (const t of micStream.getTracks()) t.stop();
        }
        const msg =
          err instanceof Error
            ? err.name === 'NotAllowedError'
              ? inIframe
                ? 'Browser blocked audio permission inside this embedded preview. Open the app in a standalone tab (top-level URL) to allow mic/tab capture, or use Audio File Upload / Live Captions with zero permissions.'
                : 'Microphone or tab-audio permission was blocked by the browser. Click the site lock/mic icon in your address bar to allow access, or use Audio File Upload / Live Captions below.'
              : err.message
            : 'Failed to start live audio capture';
        setState((prev) => ({ ...prev, capturing: false, error: msg, notice: null }));
        onError?.(msg);
        return false;
      }
    },
    [stopCapture, startChannelMonitor, onError],
  );

  React.useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return {
    audioState: state,
    startCapture,
    stopCapture,
    setMicSpeaker,
    uploadAudioFile,
  };
}
