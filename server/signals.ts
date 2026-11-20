import type {
  Battlecard,
  KnowledgeChunk,
  MeetingSession,
  ObjectionCategory,
  SupportingSourceRef,
} from '../src/types/sales.ts';

export interface DeterministicSignalMatch {
  matchedCompetitors: { canonicalName: string; matchedAlias: string }[];
  likelyObjectionCategory?: ObjectionCategory;
  isAmbiguousHesitation: boolean;
  isTechnicalQuestion: boolean;
  isBuyingSignal: boolean;
  hasAnyTrigger: boolean;
}

const OBJECTION_KEYWORDS: { category: ObjectionCategory; patterns: RegExp[] }[] = [
  {
    category: 'Price / budget',
    patterns: [/\bprice\b/i, /\bpricing\b/i, /\bexpensive\b/i, /\bbudget\b/i, /\bcost\b/i, /\bdiscount\b/i, /\bcfo\b/i, /\bquote\b/i],
  },
  {
    category: 'Implementation / migration',
    patterns: [/\bmigrat/i, /\bbandwidth\b/i, /\brip-and-replace\b/i, /\bimplementation\b/i, /\bonboard/i, /\bcutoff\b/i, /\bfreeze\b/i],
  },
  {
    category: 'Security / compliance',
    patterns: [/\bsoc2\b/i, /\bhipaa\b/i, /\bbyok\b/i, /\binfosec\b/i, /\bsecurity\b/i, /\bencrypt/i, /\bprivacy\b/i, /\bgdpr\b/i, /\btraining\b/i],
  },
  {
    category: 'Timing / priority',
    patterns: [/\bnext quarter\b/i, /\bq[1-4]\b/i, /\bpriority\b/i, /\btimeline\b/i, /\bdefer\b/i, /\bnot ready\b/i],
  },
  {
    category: 'Authority / stakeholder',
    patterns: [/\bcommittee\b/i, /\bapproval\b/i, /\bsign-off\b/i, /\bboard\b/i, /\bvp\b/i, /\bprocurement\b/i],
  },
  {
    category: 'Technical / integration',
    patterns: [/\bapi\b/i, /\bwebhook\b/i, /\bsdk\b/i, /\bthroughput\b/i, /\blatency\b/i, /\bconcurrent\b/i, /\bintegrat/i, /\bschema\b/i],
  },
  {
    category: 'Status quo',
    patterns: [/\balready have\b/i, /\bin-house\b/i, /\bstatus quo\b/i, /\bsunk cost\b/i, /\bcurrent setup\b/i],
  },
  {
    category: 'Procurement / legal',
    patterns: [/\blegal\b/i, /\bmsa\b/i, /\bredline\b/i, /\bindemnity\b/i, /\bcontract\b/i],
  },
];

export function detectDeterministicSignals(
  text: string,
  battlecards: Battlecard[],
): DeterministicSignalMatch {
  const lower = text.toLowerCase();

  // 1. Competitor canonical + alias matching
  const matchedCompetitors: { canonicalName: string; matchedAlias: string }[] = [];
  for (const bc of battlecards) {
    const candidates = [bc.competitorName, ...(bc.aliases || [])];
    for (const candidate of candidates) {
      const trimmed = candidate.trim().toLowerCase();
      if (trimmed.length >= 3 && lower.includes(trimmed)) {
        matchedCompetitors.push({
          canonicalName: bc.competitorName,
          matchedAlias: candidate,
        });
        break;
      }
    }
  }

  // 2. Objection taxonomy baseline
  let likelyObjectionCategory: ObjectionCategory | undefined;
  for (const rule of OBJECTION_KEYWORDS) {
    if (rule.patterns.some((re) => re.test(text))) {
      likelyObjectionCategory = rule.category;
      break;
    }
  }

  // 3. Ambiguous hesitation
  const isAmbiguousHesitation =
    /\b(need time to think|think about it|circle back|let us discuss internally|not sure yet)\b/i.test(
      text,
    );

  // 4. Technical question or buying signal
  const isTechnicalQuestion =
    text.includes('?') ||
    /\b(how does|do you support|can it|sla|throughput|architecture|connector)\b/i.test(text);

  const isBuyingSignal =
    /\b(sign-off|procurement|pilot|next week|before month-end|contract|timeline to go live|send the order)\b/i.test(
      text,
    );

  const hasAnyTrigger =
    matchedCompetitors.length > 0 ||
    Boolean(likelyObjectionCategory) ||
    isAmbiguousHesitation ||
    isTechnicalQuestion ||
    isBuyingSignal;

  return {
    matchedCompetitors,
    likelyObjectionCategory,
    isAmbiguousHesitation,
    isTechnicalQuestion,
    isBuyingSignal,
    hasAnyTrigger,
  };
}

export function buildCooldownFingerprint(
  meetingId: string,
  category: string,
  entityKey?: string,
): string {
  const normEntity = (entityKey || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${meetingId}::${category}::${normEntity}`;
}

export function isSuppressedByCooldown(
  meeting: MeetingSession,
  fingerprint: string,
  cooldownSeconds: number,
): boolean {
  const now = Date.now();
  const recentMatch = meeting.insights.find((ins) => {
    if (ins.fingerprint !== fingerprint) return false;
    if (ins.dismissed) return true; // Do not immediately repeat dismissed guidance (FR-050)
    // Compare time within cooldown window using transcript turn recency or timestamp
    const createdMs = Date.parse(ins.createdAt);
    if (!Number.isNaN(createdMs)) {
      return now - createdMs < cooldownSeconds * 1000;
    }
    return false;
  });

  if (recentMatch) return true;

  // Also check last 2 signals in session for same fingerprint even if timestamp was HH:MM:SS
  const recentSignals = meeting.signals.slice(-2);
  return recentSignals.some(
    (sig) =>
      `${meeting.id}::${sig.signalType}::${(sig.entityName || sig.category || 'general')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}` === fingerprint,
  );
}

export function validateCitedSources(
  citedDocIds: string[] | undefined,
  retrievedChunks: KnowledgeChunk[],
  organisationId: string,
): SupportingSourceRef[] {
  if (!citedDocIds || citedDocIds.length === 0) return [];
  const allowedByDoc = new Map<string, KnowledgeChunk>();
  for (const chunk of retrievedChunks) {
    if (chunk.organisationId === organisationId && !allowedByDoc.has(chunk.docId)) {
      allowedByDoc.set(chunk.docId, chunk);
    }
  }

  const verified: SupportingSourceRef[] = [];
  for (const docId of citedDocIds) {
    const chunk = allowedByDoc.get(docId);
    if (chunk) {
      verified.push({
        documentId: chunk.docId,
        title: chunk.docTitle,
        section: chunk.sectionTitle || chunk.category,
        excerpt: chunk.content.slice(0, 220),
      });
    }
  }
  return verified;
}
