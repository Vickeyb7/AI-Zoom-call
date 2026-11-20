import type {
  Battlecard,
  InsightCategory,
  ObjectionCategory,
  SpeakerRole,
} from '../../src/types/sales.ts';

export interface DetectedSignalResult {
  hasSignal: boolean;
  primaryType: InsightCategory | null;
  objectionCategory?: ObjectionCategory;
  matchedCompetitors: { canonicalName: string; matchedAlias: string }[];
  isPricingObjection: boolean;
  isIntegrationConcern: boolean;
  isProductCapabilityObjection: boolean;
  isSecurityConcern: boolean;
  isImplementationConcern: boolean;
  isBuyingSignal: boolean;
  isHesitationOrRisk: boolean;
  isResolutionEvidence: boolean;
  resolvedCategoryHint?: ObjectionCategory;
  confidenceScore: number;
  tags: string[];
  lifecycleKey?: string;
}

const OBJECTION_RULES: {
  category: ObjectionCategory;
  signalType: InsightCategory;
  lifecyclePrefix: string;
  patterns: RegExp[];
}[] = [
  {
    category: 'Price / budget',
    signalType: 'objection',
    lifecyclePrefix: 'pricing',
    patterns: [
      /\bpric(e|ing)\b/i,
      /\bcost(s)?\b/i,
      /\bexpensive\b/i,
      /\bhigher\b/i,
      /\bbudget\b/i,
      /\bdiscount\b/i,
      /\bjustif(y|ied)\b/i,
      /\broi\b/i,
      /\bcfo\b/i,
      /\bquote\b/i,
    ],
  },
  {
    category: 'Technical / integration',
    signalType: 'objection',
    lifecyclePrefix: 'integration',
    patterns: [
      /\bintegrat/i,
      /\bwebhook/i,
      /\bapi\b/i,
      /\bsdk\b/i,
      /\bci\/cd\b/i,
      /\bjenkins\b/i,
      /\bgithub\b/i,
      /\bgitlab\b/i,
      /\bjira\b/i,
      /\bplaywright\b/i,
      /\bselenium\b/i,
      /\bthroughput\b/i,
      /\blatency\b/i,
      /\bconcurrent\b/i,
      /\bschema\b/i,
      /\bcompatible\b/i,
      /\bexisting\s+(tools|stack|integrations|workflow)\b/i,
    ],
  },
  {
    category: 'Security / compliance',
    signalType: 'objection',
    lifecyclePrefix: 'security',
    patterns: [
      /\bsoc2\b/i,
      /\bhipaa\b/i,
      /\bbyok\b/i,
      /\binfosec\b/i,
      /\bsecurity\b/i,
      /\bencrypt/i,
      /\bprivacy\b/i,
      /\bgdpr\b/i,
      /\bsso\b/i,
      /\bsaml\b/i,
      /\bdata\s+retention\b/i,
      /\btrain(ing)?\s+(external\s+)?(ai|models)\b/i,
    ],
  },
  {
    category: 'Implementation / migration',
    signalType: 'objection',
    lifecyclePrefix: 'implementation',
    patterns: [
      /\bmigrat/i,
      /\brip-and-replace\b/i,
      /\bimplementation\b/i,
      /\bonboard/i,
      /\bcutover\b/i,
      /\bcode\s+freeze\b/i,
      /\bsetup\s+time\b/i,
    ],
  },
  {
    category: 'Need / fit',
    signalType: 'objection',
    lifecyclePrefix: 'capability',
    patterns: [
      /\bcapabilit/i,
      /\bmissing\s+feature/i,
      /\bdoes(n't| not)\s+support\b/i,
      /\bcan't\s+(do|handle)\b/i,
      /\blimitation/i,
      /\bfit\s+our\b/i,
    ],
  },
  {
    category: 'Status quo',
    signalType: 'objection',
    lifecyclePrefix: 'status-quo',
    patterns: [/\bsunk cost\b/i, /\bcurrent setup\b/i, /\balready have\b/i, /\bin-house\b/i],
  },
  {
    category: 'Procurement / legal',
    signalType: 'objection',
    lifecyclePrefix: 'procurement',
    patterns: [/\blegal\b/i, /\bmsa\b/i, /\bredline\b/i, /\bindemnity\b/i],
  },
];

const KNOWN_COMPETITOR_FALLBACKS = [
  'LambdaTest',
  'BrowserStack',
  'Sauce Labs',
  'Cypress Cloud',
  'Katalon',
  'Tricentis',
  'ApexCloud',
  'LegacySync',
  'VeloCRM',
  'SmartBear',
  'Perfecto',
  'HeadSpin',
  'Testim',
  'Mabl',
  'Selenium Grid',
];

const DYNAMIC_COMPETITOR_PATTERNS: RegExp[] = [
  /\b(?:currently\s+use|using|running|deployed|evaluating|considering|comparing\s+(?:you\s+)?(?:to|with|against)|switching\s+from|migrating\s+from|proposal\s+from|quote\s+from|offer\s+from|already\s+have|competitor)\s+([A-Z][A-Za-z0-9.+-]{2,}(?:\s+[A-Z][A-Za-z0-9.+-]{2,})?)/g,
  /\b([A-Z][A-Za-z0-9.+-]{2,}(?:\s+[A-Z][A-Za-z0-9.+-]{2,})?)\s+(?:is\s+offering|quoted\s+us|gave\s+us|told\s+us)/g,
];

const NON_COMPETITOR_WORDS = new Set([
  'We', 'Our', 'They', 'Their', 'Your', 'You', 'This', 'That', 'These', 'Those',
  'It', 'The', 'Yes', 'No', 'Not', 'Actually', 'Honestly', 'Currently', 'Right',
  'Zoom', 'Teams', 'Slack', 'Jira', 'GitHub', 'GitLab', 'Jenkins', 'AWS', 'GCP', 'Azure',
  'SOC2', 'HIPAA', 'GDPR', 'ROI', 'CFO', 'CTO', 'CEO', 'InfoSec', 'QA', 'API', 'SDK',
]);

export function detectConversationSignals(params: {
  text: string;
  speaker: SpeakerRole;
  battlecards: Battlecard[];
}): DetectedSignalResult {
  const { text, speaker, battlecards } = params;
  const lower = text.toLowerCase();

  // Neutral rep discovery questions should not trigger AI tips or fake objections
  const isRep = speaker === 'Sales Representative' || speaker === 'AE';

  // 1. Competitor Detection (tenant battlecards + aliases + market names + dynamic extraction)
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
  if (matchedCompetitors.length === 0) {
    for (const name of KNOWN_COMPETITOR_FALLBACKS) {
      if (lower.includes(name.toLowerCase())) {
        matchedCompetitors.push({ canonicalName: name, matchedAlias: name });
        break;
      }
    }
  }
  if (matchedCompetitors.length === 0 && !isRep) {
    for (const pattern of DYNAMIC_COMPETITOR_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match && match[1]) {
        const candidate = match[1].trim();
        const firstWord = candidate.split(/\s+/)[0];
        if (!NON_COMPETITOR_WORDS.has(candidate) && !NON_COMPETITOR_WORDS.has(firstWord)) {
          matchedCompetitors.push({ canonicalName: candidate, matchedAlias: candidate });
          break;
        }
      }
    }
  }

  // 2. Objection Detection & Classification
  let matchedRule: (typeof OBJECTION_RULES)[number] | undefined;
  if (!isRep) {
    for (const rule of OBJECTION_RULES) {
      if (rule.patterns.some((re) => re.test(text))) {
        matchedRule = rule;
        break;
      }
    }
  }

  // 3. Buying Signal Detection
  const isBuyingSignal =
    !isRep &&
    /\b(exploring alternatives|looking for alternatives|sign-off|procurement|pilot|next week|before month-end|timeline to go live|move forward|send the order)\b/i.test(
      text,
    );

  // 4. Hesitation & Deal Risk Detection
  const isHesitationOrRisk =
    !isRep &&
    /\b(need time to think|think about it|circle back|discuss internally|not sure yet|hesitant|hold off|push back|concerned)\b/i.test(
      text,
    );

  // 5. Conversational Resolution Evidence Detection
  const isResolutionEvidence =
    !isRep &&
    /\b(makes sense|that answers|good catch|fair point|aligned|works for us|solves our|relieved|satisfied with that)\b/i.test(
      text,
    );

  const isPureResolution =
    isResolutionEvidence && !/\b(but|however|still|though|yet)\b/i.test(text);
  const resolvedCategoryHint = isPureResolution ? matchedRule?.category : undefined;
  if (isPureResolution) {
    matchedRule = undefined;
  }

  const isPricingObjection = matchedRule?.category === 'Price / budget';
  const isIntegrationConcern = matchedRule?.category === 'Technical / integration';
  const isProductCapabilityObjection = matchedRule?.category === 'Need / fit';
  const isSecurityConcern = matchedRule?.category === 'Security / compliance';
  const isImplementationConcern = matchedRule?.category === 'Implementation / migration';

  const tags: string[] = [];
  if (!isPureResolution) {
    for (const comp of matchedCompetitors) {
      tags.push(`Competitor: ${comp.canonicalName}`);
    }
  }
  if (matchedRule) {
    tags.push(`Objection: ${matchedRule.category}`);
  }
  if (isBuyingSignal) {
    tags.push('Buying Signal');
  }
  if (isHesitationOrRisk && !matchedRule && !isPureResolution) {
    tags.push('Hesitation / Deal Risk');
  }
  if (isResolutionEvidence) {
    tags.push('Resolution Cue');
  }

  // Determine primary signal type & lifecycle key
  let primaryType: InsightCategory | null = null;
  let objectionCategory: ObjectionCategory | undefined = matchedRule?.category;
  let lifecycleKey: string | undefined;
  let confidenceScore = 0;

  if (!isPureResolution) {
    if (matchedRule) {
      primaryType = 'objection';
      lifecycleKey = `obj-${matchedRule.lifecyclePrefix}`;
      confidenceScore = 88;
    } else if (matchedCompetitors.length > 0 && !isRep) {
      primaryType = 'competitor';
      objectionCategory = 'Competition / alternative';
      lifecycleKey = `comp-${matchedCompetitors[0].canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      confidenceScore = 92;
    } else if (isBuyingSignal) {
      primaryType = 'buying_signal';
      lifecycleKey = 'buying-signal-evaluation';
      confidenceScore = 84;
    } else if (isHesitationOrRisk) {
      primaryType = 'risk';
      lifecycleKey = 'risk-hesitation';
      confidenceScore = 68;
    }
  }

  const hasSignal = primaryType !== null;

  return {
    hasSignal,
    primaryType,
    objectionCategory,
    matchedCompetitors: isPureResolution ? [] : matchedCompetitors,
    isPricingObjection,
    isIntegrationConcern,
    isProductCapabilityObjection,
    isSecurityConcern,
    isImplementationConcern,
    isBuyingSignal: isPureResolution ? false : isBuyingSignal,
    isHesitationOrRisk: isPureResolution ? false : isHesitationOrRisk,
    isResolutionEvidence,
    resolvedCategoryHint,
    confidenceScore,
    tags,
    lifecycleKey,
  };
}
