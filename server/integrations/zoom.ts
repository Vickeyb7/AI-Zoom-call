import crypto from 'crypto';
import type { MeetingSession, SpeakerRole, ZoomLinkState } from '../../src/types/sales.ts';

export interface NormalizedZoomWebhookResult {
  kind: 'url_validation' | 'transcript' | 'bot_status' | 'ignored';
  plainToken?: string;
  encryptedToken?: string;
  meetingId?: string;
  botId?: string;
  provider: ZoomLinkState['provider'];
  statusUpdate?: ZoomLinkState['status'];
  statusNote?: string;
  speakerName?: string;
  speakerRole?: SpeakerRole;
  text?: string;
  isFinal?: boolean;
  eventId?: string;
}

export function isValidZoomMeetingUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'zoom.us' || host.endsWith('.zoom.us') || host === 'zoom.us.cn';
  } catch {
    return false;
  }
}

export function verifyZoomWebhookSignature(params: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  secret?: string;
}): boolean {
  const secret = params.secret?.trim();
  if (!secret) return true; // Verification optional unless ZOOM_WEBHOOK_SECRET is configured

  const getHeader = (name: string): string | undefined => {
    const val = params.headers[name.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  // Format 1: Zoom official signature header (`x-zm-signature: v0=<hex>` + `x-zm-request-timestamp`)
  const zmSig = getHeader('x-zm-signature');
  const zmTs = getHeader('x-zm-request-timestamp');
  if (zmSig && zmTs) {
    const message = `v0:${zmTs}:${params.rawBody}`;
    const expected = `v0=${crypto.createHmac('sha256', secret).update(message).digest('hex')}`;
    const a = Buffer.from(zmSig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // Format 2: Generic HMAC-SHA256 signature header (`x-webhook-signature` or `x-zoom-signature`)
  const genericSig = getHeader('x-webhook-signature') || getHeader('x-zoom-signature');
  if (!genericSig) return false;

  const cleaned = genericSig.replace(/^sha256=/i, '').trim();
  const expectedHex = crypto.createHmac('sha256', secret).update(params.rawBody).digest('hex');
  const a = Buffer.from(cleaned);
  const b = Buffer.from(expectedHex);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function classifyZoomSpeaker(
  speakerName: string | undefined,
  explicitRole: string | undefined,
  meeting: MeetingSession,
): { speaker: SpeakerRole; speakerName: string } {
  const cleanName = (speakerName || '').trim();
  const roleHint = (explicitRole || '').trim().toLowerCase();

  if (
    roleHint === 'sales representative' ||
    roleHint === 'sales_rep' ||
    roleHint === 'rep' ||
    roleHint === 'ae' ||
    roleHint === 'host'
  ) {
    return {
      speaker: 'Sales Representative',
      speakerName: cleanName || `${meeting.aeName} (Sales Rep)`,
    };
  }

  if (roleHint === 'prospect' || roleHint === 'customer' || roleHint === 'guest') {
    return {
      speaker: 'Prospect',
      speakerName: cleanName || meeting.prospectStakeholders[0] || 'Zoom Prospect',
    };
  }

  if (cleanName) {
    const speakerLower = cleanName.toLowerCase();
    // 1. If the speaker matches any known prospect stakeholder on this meeting, always classify as Prospect
    const matchesKnownProspect = meeting.prospectStakeholders.some((stakeholder) => {
      const cleanedStakeholder = stakeholder.replace(/\([^)]*\)/g, '').trim().toLowerCase();
      if (!cleanedStakeholder) return false;
      return (
        speakerLower === cleanedStakeholder ||
        speakerLower.includes(cleanedStakeholder) ||
        cleanedStakeholder.includes(speakerLower)
      );
    });
    if (matchesKnownProspect) {
      return { speaker: 'Prospect', speakerName: cleanName };
    }

    // 2. Match Sales Rep by full name, or exact single-word first name (avoid matching "Elena Rostova" to "Elena Vance")
    const aeLower = meeting.aeName.trim().toLowerCase();
    const aeParts = aeLower.split(/\s+/).filter(Boolean);
    const speakerParts = speakerLower.replace(/\([^)]*\)/g, '').trim().split(/\s+/).filter(Boolean);
    const isExactAeName =
      speakerLower === aeLower ||
      speakerLower.startsWith(`${aeLower} `) ||
      speakerLower.includes(`(${aeLower})`);
    const isSingleWordAeFirst =
      speakerParts.length === 1 && aeParts.length > 0 && aeParts[0].length >= 3 && speakerParts[0] === aeParts[0];

    if (isExactAeName || isSingleWordAeFirst) {
      return { speaker: 'Sales Representative', speakerName: cleanName };
    }
  }

  return {
    speaker: 'Prospect',
    speakerName: cleanName || meeting.prospectStakeholders[0] || 'Zoom Prospect',
  };
}

function mapRecallStatus(code: string | undefined): ZoomLinkState['status'] {
  const normalized = (code || '').toLowerCase();
  if (normalized.includes('joining') || normalized.includes('waiting')) return 'joining';
  if (normalized.includes('in_call') || normalized.includes('recording')) return 'in_call';
  if (normalized.includes('done') || normalized.includes('ended')) return 'done';
  if (normalized.includes('fatal') || normalized.includes('error')) return 'error';
  return 'in_call';
}

export function normalizeZoomWebhookPayload(
  body: Record<string, unknown>,
  queryMeetingId?: string,
  secret?: string,
): NormalizedZoomWebhookResult {
  const event = typeof body.event === 'string' ? body.event : '';

  // 1. Zoom official URL validation challenge
  if (event === 'endpoint.url_validation') {
    const payload = (body.payload || {}) as Record<string, unknown>;
    const plainToken = typeof payload.plainToken === 'string' ? payload.plainToken : '';
    const encryptedToken = secret
      ? crypto.createHmac('sha256', secret).update(plainToken).digest('hex')
      : '';
    return {
      kind: 'url_validation',
      plainToken,
      encryptedToken,
      provider: 'zoom_rtms',
    };
  }

  // 2. Recall.ai bot status webhook (`event: 'bot.status_change'`)
  if (event === 'bot.status_change' && body.data && typeof body.data === 'object') {
    const data = body.data as Record<string, unknown>;
    const botId = typeof data.bot_id === 'string' ? data.bot_id : undefined;
    const statusObj = (data.status || {}) as Record<string, unknown>;
    const code = typeof statusObj.code === 'string' ? statusObj.code : undefined;
    return {
      kind: 'bot_status',
      meetingId: queryMeetingId || (typeof body.meetingId === 'string' ? body.meetingId : undefined),
      botId,
      provider: 'recall',
      statusUpdate: mapRecallStatus(code),
      statusNote: code ? `Recall bot status: ${code}` : 'Recall status update received',
    };
  }

  // 3. Recall.ai real-time transcript webhook (`event: 'transcript.data'` or `'transcript.partial_data'`)
  if (
    (event === 'transcript.data' || event === 'transcript.partial_data' || event === 'bot.transcript') &&
    body.data &&
    typeof body.data === 'object'
  ) {
    const outer = body.data as Record<string, unknown>;
    const botObj = (outer.bot || {}) as Record<string, unknown>;
    const botId =
      (typeof outer.bot_id === 'string' && outer.bot_id) ||
      (typeof botObj.id === 'string' && botObj.id) ||
      undefined;

    const inner = (outer.data && typeof outer.data === 'object' ? outer.data : outer) as Record<
      string,
      unknown
    >;
    const participant = (inner.participant || {}) as Record<string, unknown>;
    const speakerName =
      (typeof participant.name === 'string' && participant.name) ||
      (typeof inner.speaker === 'string' && inner.speaker) ||
      undefined;
    const isHost = participant.is_host === true;

    let text = typeof inner.text === 'string' ? inner.text : '';
    if (!text && Array.isArray(inner.words)) {
      text = inner.words
        .map((w) => (w && typeof w === 'object' && typeof (w as { text?: unknown }).text === 'string' ? (w as { text: string }).text : ''))
        .filter(Boolean)
        .join(' ')
        .trim();
    }

    const isFinal =
      event === 'transcript.partial_data'
        ? false
        : typeof inner.is_final === 'boolean'
        ? inner.is_final
        : true;

    const speakerRole: SpeakerRole | undefined =
      participant.is_host === true
        ? 'Sales Representative'
        : participant.is_host === false
        ? 'Prospect'
        : undefined;

    return {
      kind: text.trim() && isFinal ? 'transcript' : 'ignored',
      meetingId: queryMeetingId || (typeof body.meetingId === 'string' ? body.meetingId : undefined),
      botId,
      provider: 'recall',
      statusUpdate: 'in_call',
      speakerName,
      speakerRole,
      text: text.trim(),
      isFinal,
      eventId: typeof body.id === 'string' ? body.id : undefined,
    };
  }

  // 4. Zoom RTMS / Zoom live transcript webhook
  if (event.startsWith('meeting.rtms') || event.includes('transcript')) {
    const payload = (body.payload || body.data || {}) as Record<string, unknown>;
    const obj = (payload.object || payload) as Record<string, unknown>;
    const text =
      (typeof obj.transcript_text === 'string' && obj.transcript_text) ||
      (typeof obj.text === 'string' && obj.text) ||
      (typeof obj.data === 'string' && obj.data) ||
      '';
    const speakerName =
      (typeof obj.speaker_name === 'string' && obj.speaker_name) ||
      (typeof obj.participant_name === 'string' && obj.participant_name) ||
      (typeof obj.user_name === 'string' && obj.user_name) ||
      undefined;
    const role = typeof obj.role === 'string' ? obj.role : undefined;

    return {
      kind: text.trim() ? 'transcript' : 'ignored',
      meetingId:
        queryMeetingId ||
        (typeof body.meetingId === 'string' ? body.meetingId : undefined) ||
        (typeof obj.meeting_id === 'string' ? obj.meeting_id : undefined),
      provider: 'zoom_rtms',
      statusUpdate: 'in_call',
      speakerName,
      speakerRole: role as SpeakerRole | undefined,
      text: text.trim(),
      isFinal: true,
      eventId: typeof body.event_id === 'string' ? body.event_id : undefined,
    };
  }

  // 5. Generic direct webhook format: { meetingId, speakerName, speakerRole?, text, isFinal?, eventId? }
  const directText = typeof body.text === 'string' ? body.text.trim() : '';
  if (directText) {
    const isFinal = typeof body.isFinal === 'boolean' ? body.isFinal : true;
    return {
      kind: isFinal ? 'transcript' : 'ignored',
      meetingId: queryMeetingId || (typeof body.meetingId === 'string' ? body.meetingId : undefined),
      botId: typeof body.botId === 'string' ? body.botId : undefined,
      provider:
        body.provider === 'recall' || body.provider === 'zoom_rtms' ? body.provider : 'webhook',
      statusUpdate: 'in_call',
      speakerName: typeof body.speakerName === 'string' ? body.speakerName : undefined,
      speakerRole: typeof body.speakerRole === 'string' ? (body.speakerRole as SpeakerRole) : undefined,
      text: directText,
      isFinal,
      eventId: typeof body.eventId === 'string' ? body.eventId : undefined,
    };
  }

  return {
    kind: 'ignored',
    meetingId: queryMeetingId,
    provider: 'webhook',
  };
}

export function resolveRecallBaseUrl(rawRegion?: string): string {
  const trimmed = (rawRegion || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://us-west-2.recall.ai';
  if (/^[a-z]{2}-[a-z]+-\d$/.test(trimmed)) {
    return `https://${trimmed}.recall.ai`;
  }
  if (/^https?:\/\/[^/]*recall\.ai$/i.test(trimmed)) {
    return trimmed;
  }
  return 'https://us-west-2.recall.ai';
}

export async function dispatchRecallBot(params: {
  meetingUrl: string;
  botName: string;
  webhookUrl: string;
}): Promise<{ botId: string; status: string }> {
  const apiKey = process.env.RECALL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'RECALL_API_KEY is not configured in server environment secrets. Add RECALL_API_KEY to enable automated Recall.ai Zoom bot joining, or push live transcripts directly to the webhook URL.',
    );
  }
  const baseUrl = resolveRecallBaseUrl(process.env.RECALL_REGION);
  const endpoint = `${baseUrl}/api/v1/bot/`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meeting_url: params.meetingUrl,
      bot_name: params.botName,
      recording_config: {
        transcript: {
          provider: {
            meeting_captions: {},
          },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: params.webhookUrl,
            events: ['transcript.data', 'bot.status_change'],
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Recall.ai bot dispatch failed (${response.status}): ${errText.slice(0, 220)}`);
  }

  const data = (await response.json()) as { id?: string; status_changes?: { code?: string }[] };
  if (!data.id) {
    throw new Error('Recall.ai returned no bot ID');
  }
  return {
    botId: data.id,
    status: data.status_changes?.[0]?.code || 'joining_call',
  };
}

export async function leaveRecallBot(botId: string): Promise<void> {
  const apiKey = process.env.RECALL_API_KEY?.trim();
  if (!apiKey || !botId) return;
  const baseUrl = resolveRecallBaseUrl(process.env.RECALL_REGION);
  await fetch(`${baseUrl}/api/v1/bot/${encodeURIComponent(botId)}/leave_call/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
  }).catch(() => undefined);
}
