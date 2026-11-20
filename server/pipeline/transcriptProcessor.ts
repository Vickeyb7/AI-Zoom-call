import type { MeetingSession, SpeakerRole, TranscriptTurn } from '../../src/types/sales.ts';

export function formatNowTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function normalizeSpeakerRole(speaker?: string): SpeakerRole {
  if (speaker === 'Sales Representative' || speaker === 'AE') {
    return 'Sales Representative';
  }
  return 'Prospect';
}

export function isRepSpeaker(speaker: SpeakerRole): boolean {
  return speaker === 'Sales Representative' || speaker === 'AE';
}

export function recalculateTalkRatio(transcript: TranscriptTurn[]): {
  aeTalkRatio: number;
  prospectTalkRatio: number;
} {
  if (transcript.length === 0) return { aeTalkRatio: 0, prospectTalkRatio: 0 };
  let repWords = 0;
  let prospectWords = 0;
  for (const turn of transcript) {
    const words = turn.text.split(/\s+/).filter(Boolean).length;
    if (isRepSpeaker(turn.speaker)) repWords += words;
    else prospectWords += words;
  }
  const total = repWords + prospectWords;
  if (total === 0) return { aeTalkRatio: 50, prospectTalkRatio: 50 };
  const repPct = Math.round((repWords / total) * 100);
  return { aeTalkRatio: repPct, prospectTalkRatio: 100 - repPct };
}

export function processIncomingTranscriptEvent(params: {
  meeting: MeetingSession;
  speaker?: string;
  speakerName?: string;
  text: string;
  eventId?: string;
}): { turn: TranscriptTurn | null; deduplicated: boolean } {
  const { meeting, speaker, speakerName, text, eventId } = params;

  if (meeting.status === 'paused') {
    throw new Error('Meeting is paused. Resume meeting before sending transcript events.');
  }
  if (meeting.status === 'completed' || meeting.status === 'failed') {
    throw new Error('Meeting has ended. Reset or start a new meeting to capture transcript events.');
  }

  if (eventId && meeting.transcript.some((t) => t.eventId === eventId)) {
    return { turn: null, deduplicated: true };
  }

  if (meeting.status === 'created') {
    meeting.status = 'active';
    meeting.captureConsentConfirmed = true;
  }

  const normalizedRole = normalizeSpeakerRole(speaker);
  const turn: TranscriptTurn = {
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    eventId,
    speaker: normalizedRole,
    speakerName:
      speakerName?.trim() ||
      (isRepSpeaker(normalizedRole)
        ? meeting.aeName
        : meeting.prospectStakeholders[0] || 'Prospect'),
    text: text.trim(),
    timestamp: formatNowTime(),
    detectedTags: [],
    sentimentScore: 0,
  };

  meeting.transcript.push(turn);
  meeting.durationMinutes = Math.max(1, meeting.durationMinutes + 1);
  const ratios = recalculateTalkRatio(meeting.transcript);
  meeting.aeTalkRatio = ratios.aeTalkRatio;
  meeting.prospectTalkRatio = ratios.prospectTalkRatio;

  return { turn, deduplicated: false };
}
