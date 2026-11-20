import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import type {
  AuditEvent,
  Battlecard,
  CopilotPreferences,
  DashboardData,
  EvaluationMetrics,
  KnowledgeChunk,
  KnowledgeDoc,
  MeetingSession,
  MeetingStakeholderSummary,
  Organisation,
  RagSearchResult,
  StakeholderInteraction,
  StakeholderProfile,
  UserProfile,
} from '../src/types/sales.ts';
import { getTranscriptRetentionDays, salesAI } from './ai.ts';
import { getEmbeddingConfig } from './embeddings.ts';
import { logger } from './logger.ts';

export interface StoreState {
  organisations: Organisation[];
  users: UserProfile[];
  auditEvents: AuditEvent[];
  meetings: MeetingSession[];
  stakeholders: StakeholderProfile[];
  knowledgeDocs: KnowledgeDoc[];
  knowledgeChunks: KnowledgeChunk[];
  battlecards: Battlecard[];
  preferencesByUser?: Record<string, CopilotPreferences>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

export function computeSha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.33));
}

export function extractHtmlText(html: string): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

  cleaned = cleaned
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '\n| $1 |')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(p|div|section|article|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function lexicalScore(query: string, text: string, headingText = ''): number {
  const tokens = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2),
    ),
  );
  if (tokens.length === 0) return 0;
  const hay = text.toLowerCase();
  const headingHay = headingText.toLowerCase();
  let hits = 0;
  let headingBonus = 0;
  for (const tok of tokens) {
    if (hay.includes(tok)) hits += 1;
    if (headingHay && headingHay.includes(tok)) headingBonus += 0.25;
  }
  const base = hits / tokens.length;
  return Math.min(1, base + Math.min(0.25, headingBonus / Math.max(1, tokens.length)));
}

export interface StructuredChunkPiece {
  content: string;
  sectionTitle?: string;
  headingPath?: string;
  pageNumber?: number;
  tokenCount: number;
  isAtomicFact: boolean;
}

function detectAtomicFact(block: string): boolean {
  const lower = block.toLowerCase();
  if (/\|.+\|/.test(block)) return true; // Markdown/HTML table row
  if (/(\$\d+|\d+%|sla|soc2|soc 2|hipaa|iso 27001|fedramp|rpo|p99)/i.test(lower) && block.length < 650) {
    return true;
  }
  if (/^(q:|a:|prospect objection:|recommended)/i.test(block.trim())) return true;
  return false;
}

function takeTrailingOverlap(text: string, overlapTokens: number): string {
  if (!text || overlapTokens <= 0) return '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  const targetWords = Math.max(12, Math.floor(overlapTokens / 1.33));
  if (words.length <= targetWords) return '';
  return words.slice(-targetWords).join(' ');
}

export function chunkTextWithSections(
  text: string,
  options?: {
    targetTokens?: number;
    minTokens?: number;
    maxTokens?: number;
    overlapTokens?: number;
  },
): StructuredChunkPiece[] {
  const targetTokens = options?.targetTokens ?? 500;
  const minTokens = options?.minTokens ?? 150;
  const maxTokens = options?.maxTokens ?? 800;
  const overlapTokens = options?.overlapTokens ?? 75;

  const blocks = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: StructuredChunkPiece[] = [];
  const headingStack: { level: number; text: string }[] = [];
  let current = '';
  let currentSection: string | undefined;
  let currentHeadingPath: string | undefined;
  let currentPageNumber: number | undefined;
  let currentAtomic = false;

  const flushChunk = (withOverlap: boolean) => {
    const trimmed = current.trim();
    if (!trimmed) return;
    chunks.push({
      content: trimmed,
      sectionTitle: currentSection,
      headingPath: currentHeadingPath,
      pageNumber: currentPageNumber,
      tokenCount: estimateTokens(trimmed),
      isAtomicFact: currentAtomic,
    });
    current = withOverlap ? takeTrailingOverlap(trimmed, overlapTokens) : '';
    currentAtomic = false;
  };

  for (const block of blocks) {
    const mdHeading = block.match(/^(#{1,4})\s+(.+)$/);
    const slideOrPage = block.match(/^\[(Slide|Page)\s+(\d+)\]/i);

    if (mdHeading) {
      // Flush previous section before starting a new heading if we have enough tokens
      if (current.trim() && estimateTokens(current) >= minTokens) {
        flushChunk(false);
      }
      const level = mdHeading[1].length;
      const headingText = mdHeading[2].trim().slice(0, 90);
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text: headingText });
      currentSection = headingText;
      currentHeadingPath = headingStack.map((h) => h.text).join(' > ');
    } else if (slideOrPage) {
      if (current.trim() && estimateTokens(current) >= minTokens) {
        flushChunk(false);
      }
      currentPageNumber = parseInt(slideOrPage[2], 10);
      currentSection = `${slideOrPage[1]} ${slideOrPage[2]}`;
      currentHeadingPath = currentSection;
    }

    const blockTokens = estimateTokens(block);
    const blockIsAtomic = detectAtomicFact(block);

    // If single block exceeds maxTokens, split cleanly on sentences with overlap
    if (blockTokens > maxTokens) {
      if (current.trim()) flushChunk(false);
      const sentences = block.split(/(?<=[.!?])\s+/).filter(Boolean);
      let acc = '';
      for (const s of sentences) {
        const candidate = acc ? `${acc} ${s}` : s;
        if (estimateTokens(candidate) > targetTokens && acc.trim()) {
          chunks.push({
            content: acc.trim(),
            sectionTitle: currentSection,
            headingPath: currentHeadingPath,
            pageNumber: currentPageNumber,
            tokenCount: estimateTokens(acc),
            isAtomicFact: false,
          });
          const overlap = takeTrailingOverlap(acc, overlapTokens);
          acc = overlap ? `${overlap} ${s}` : s;
        } else {
          acc = candidate;
        }
      }
      if (acc.trim()) {
        current = acc.trim();
        currentAtomic = false;
      }
      continue;
    }

    const combined = current ? `${current}\n\n${block}` : block;
    const combinedTokens = estimateTokens(combined);

    if (combinedTokens > targetTokens && current.trim() && estimateTokens(current) >= minTokens) {
      flushChunk(true);
      current = current ? `${current}\n\n${block}` : block;
      currentAtomic = blockIsAtomic;
    } else {
      current = combined;
      currentAtomic = currentAtomic || blockIsAtomic;
    }
  }

  if (current.trim()) {
    flushChunk(false);
  }

  if (chunks.length === 0 && text.trim()) {
    const trimmed = text.trim();
    chunks.push({
      content: trimmed,
      sectionTitle: currentSection,
      headingPath: currentHeadingPath,
      pageNumber: currentPageNumber,
      tokenCount: estimateTokens(trimmed),
      isAtomicFact: detectAtomicFact(trimmed),
    });
  }
  return chunks;
}

export async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const nb = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return na - nb;
    });

  const sections: string[] = [];
  for (const fileName of slideFiles) {
    const slideNum = fileName.match(/\d+/)?.[0] || '?';
    const xml = await zip.files[fileName].async('text');
    const textMatches = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((m) =>
      m[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim(),
    );
    const joined = textMatches.filter(Boolean).join(' ');
    if (joined) {
      sections.push(`[Slide ${slideNum}]\n${joined}`);
    }
  }
  return sections.join('\n\n').trim();
}

function createSeedState(): StoreState {
  const organisations: Organisation[] = [
    {
      id: 'org-acme',
      name: 'Acme Cloud Systems',
      plan: 'Enterprise',
      settings: {
        retentionDays: 90,
        cooldownSeconds: 45,
        abstentionEnabled: true,
        requireCaptureConsent: true,
        qualificationFramework: [
          'Metrics',
          'Economic Buyer',
          'Decision Criteria',
          'Decision Process',
          'Identify Pain',
          'Champion',
          'Competition',
        ],
      },
    },
    {
      id: 'org-northbridge',
      name: 'Northbridge Security (Isolated Tenant)',
      plan: 'Pilot',
      settings: {
        retentionDays: 30,
        cooldownSeconds: 60,
        abstentionEnabled: true,
        requireCaptureConsent: true,
        qualificationFramework: ['Budget', 'Authority', 'Need', 'Timeline'],
      },
    },
  ];

  const users: UserProfile[] = [
    {
      id: 'usr-elena',
      organisationId: 'org-acme',
      name: 'Elena Vance',
      email: 'elena.vance@acmecloud.io',
      role: 'Organisation Admin',
      status: 'active',
    },
    {
      id: 'usr-marcus-mgr',
      organisationId: 'org-acme',
      name: 'Devon Brooks',
      email: 'devon.brooks@acmecloud.io',
      role: 'Sales Manager',
      status: 'active',
    },
    {
      id: 'usr-sarah-km',
      organisationId: 'org-acme',
      name: 'Sarah Lin',
      email: 'sarah.lin@acmecloud.io',
      role: 'Knowledge Manager',
      status: 'active',
    },
    {
      id: 'usr-nb-rep',
      organisationId: 'org-northbridge',
      name: 'Jordan Mercer',
      email: 'j.mercer@northbridgesec.io',
      role: 'Organisation Admin',
      status: 'active',
    },
  ];

  const rawDocs: {
    id: string;
    organisationId: string;
    title: string;
    fileName: string;
    fileType: KnowledgeDoc['fileType'];
    category: KnowledgeDoc['category'];
    owner: string;
    version: string;
    reviewDate: string;
    summary: string;
    uploadedAt: string;
    content: string;
    sourceMode?: 'mock_kb' | 'uploaded_kb';
  }[] = [
    {
      id: 'doc-lambdatest-bc',
      organisationId: 'org-acme',
      title: 'LambdaTest Competitive Battlecard & Cross-Browser Matrix (Mock KB)',
      fileName: 'lambdatest-battlecard-mock-kb.md',
      fileType: 'md',
      category: 'Competitor Battlecards',
      owner: 'Competitive Intelligence',
      version: 'v1.4',
      reviewDate: '2027-02-01',
      sourceMode: 'mock_kb',
      summary:
        'Approved positioning vs LambdaTest: flaky-test triage overhead, private VPC tunnel stability, CI queue wait times, and total engineering cost.',
      uploadedAt: '2026-11-16T10:00:00Z',
      content: `# LambdaTest Positioning & Tradeoffs
LambdaTest offers broad self-serve device/browser coverage at competitive entry pricing. However, scaling enterprise QA teams report:
1. Shared grid concurrency queues add 4–9 minutes per CI run during peak release windows unless dedicated enterprise concurrency add-ons are purchased.
2. No deterministic flaky-test root-cause clustering out of the box—QA engineers spend 12–18 hours/week triaging false failures across Playwright and Selenium suites.
3. Private VPC/on-prem tunnel drops under high-parallelism microservices testing require manual tunnel restarts.

# Our Differentiators vs LambdaTest
- Deterministic AI flaky-test quarantine and automatic trace root-causing cuts QA triage time by 60%.
- Sub-15-second cold-start isolated browser pods with zero shared-grid queue contention.
- Native mTLS private-network connectors without fragile local tunnel daemons.

# Approved Discovery Questions
- "When your team runs parallel Playwright or Selenium suites before release, how much time do engineers spend triaging flaky failures versus shipping tests?"
- "Have you modeled the engineering hours lost waiting on shared browser queues or restarting private network tunnels?"`,
    },
    {
      id: 'doc-integrations',
      organisationId: 'org-acme',
      title: 'Enterprise CI/CD, Git & Issue Tracker Integrations Guide (Mock KB)',
      fileName: 'integrations-architecture-mock-kb.md',
      fileType: 'md',
      category: 'Product Documentation',
      owner: 'Solutions Engineering',
      version: 'v3.1',
      reviewDate: '2027-03-01',
      sourceMode: 'mock_kb',
      summary:
        'Native integrations for GitHub Actions, GitLab CI, Jenkins, CircleCI, Jira, Slack, Playwright, Cypress, Selenium, and SAML SSO.',
      uploadedAt: '2026-11-16T10:05:00Z',
      content: `# Supported CI/CD & Source Control Integrations
Native zero-config plugins and GitHub/GitLab Actions orbs exist for:
- CI/CD Runners: GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure DevOps, Buildkite.
- Test Frameworks: Drop-in SDK adapters for Playwright, Cypress, Selenium WebDriver, and Appium (requires 1 environment endpoint change, zero test rewrites).
- Issue & Alerting Workflows: Bidirectional Jira Cloud/Data Center ticket sync, Slack failure digests, and PagerDuty/Webhook notifications.
- Identity & Security: Okta/Azure AD SAML 2.0 SSO, SCIM provisioning, and REST/GraphQL APIs for custom internal dashboards.`,
    },
    {
      id: 'doc-qa-casestudy',
      organisationId: 'org-acme',
      title: 'Customer Case Study: FinGrid QA Consolidation ROI (Mock KB)',
      fileName: 'fingrid-qa-case-study-mock-kb.md',
      fileType: 'md',
      category: 'Case Studies & ROI',
      owner: 'Product Marketing',
      version: 'v1.2',
      reviewDate: '2027-01-20',
      sourceMode: 'mock_kb',
      summary:
        'How FinGrid justified switching from a lower-cost grid vendor by saving 42% in CI runner time and $190k/yr in QA triage overhead.',
      uploadedAt: '2026-11-16T10:10:00Z',
      content: `# Case Study: FinGrid Financial Systems
FinGrid initially flagged our platform as 22% higher in annual license price compared to their incumbent cloud grid.
After a 14-day side-by-side pilot running 1,400 Playwright specs:
- CI pipeline wait time dropped by 42% (saving 19 minutes per PR merge).
- Automated flaky-test clustering reclaimed 16 engineering hours per week ($190,000/yr in engineering productivity).
- Net Year-1 ROI was 3.4x, fully justifying the license delta to Finance before signature.`,
    },
    {
      id: 'doc-1',
      organisationId: 'org-acme',
      title: 'ApexCloud Competitive Battlecard & Architecture Delta',
      fileName: 'apexcloud-battlecard-q4.md',
      fileType: 'md',
      category: 'Competitor Battlecards',
      owner: 'Sarah Lin',
      version: 'v3.2',
      reviewDate: '2026-12-15',
      summary:
        'Latency benchmarks, multi-region failover gaps, and total cost of ownership counters against ApexCloud.',
      uploadedAt: '2026-11-10T14:20:00Z',
      content: `# Architecture & Latency Gap
ApexCloud relies on scheduled 15-minute batch replication across regional clusters, which introduces stale telemetry windows during peak traffic spikes. Our platform streams events via zero-copy CDC pipelines with sub-180ms p99 end-to-end latency.

# Hidden Egress & Overage Fees
ApexCloud quotes a low base seat license ($48/user) but charges $0.14 per GB for cross-region query egress and requires a separate $45k/yr Enterprise Audit add-on for SOC2 Type II log retention beyond 30 days. Our Enterprise tier includes unlimited cross-region failover and 7-year immutable audit logs out of the box.

# Landmine Discovery Questions
- "When your compliance team audits cross-region data lineage, how does ApexCloud handle real-time RPO without triggering egress multipliers?"
- "Have they shared contractual SLAs on query p99 latency once concurrent dashboards exceed 250 users?"`,
    },
    {
      id: 'doc-2',
      organisationId: 'org-acme',
      title: 'Enterprise Security, SOC2 Type II & HIPAA Posture',
      fileName: 'enterprise-security-whitepaper.pdf',
      fileType: 'pdf',
      category: 'Security & Compliance',
      owner: 'InfoSec Governance',
      version: 'v4.0',
      reviewDate: '2027-01-30',
      summary:
        'Zero-trust encryption architecture, customer-managed keys (BYOK), SOC2 Type II, ISO 27001, and HIPAA BAA readiness.',
      uploadedAt: '2026-11-08T09:15:00Z',
      content: `# Certifications & Attestations
We maintain continuous SOC2 Type II compliance (zero exceptions over 4 consecutive audit cycles), ISO 27001:2022, HIPAA BAA execution on Day 1, and FedRAMP Moderate equivalency controls.

# Encryption & Key Ownership
All customer payloads are encrypted in transit via TLS 1.3 and at rest with AES-256-GCM. Enterprise accounts can enable Customer-Managed Keys (BYOK) via AWS KMS or GCP Cloud KMS with instant cryptographic revocation in under 60 seconds.

# Data Residency & AI Governance
Customer transcripts and proprietary documents are isolated in single-tenant logical namespaces. Zero customer data is ever retained or used for foundation model training.`,
    },
    {
      id: 'doc-3',
      organisationId: 'org-acme',
      title: 'Commercial Pricing, Volume Tiers & CFO ROI Playbook',
      fileName: 'pricing-roi-playbook-2026.docx',
      fileType: 'docx',
      category: 'Pricing & Packaging',
      owner: 'RevOps & Finance',
      version: 'v2.4',
      reviewDate: '2026-12-31',
      summary:
        'Enterprise pricing guardrails, multi-year commit discounts, and validated 3.8x payback ROI metrics for CFO objections.',
      uploadedAt: '2026-11-12T16:40:00Z',
      content: `# Enterprise Platform Licensing
Core Platform Base: $65,000/year (includes 50 seats, 5TB streaming ingestion, SOC2 audit retention, and dedicated Solutions Architect).
Additional Seats: $95/seat/month (tiered down to $72/seat/month at 250+ seats).

# Handling Price Objections
Never discount seat price first. Anchor on Total Cost of Ownership (TCO):
1. LegacySync and ApexCloud require 2.5 FTE data engineers (~$380k/yr fully loaded) to maintain brittle connectors. Our managed schema-drift engine eliminates connector maintenance within 14 days.
2. Customers realize an average 3.8x ROI within 6 months and 22% faster enterprise deal cycles.
3. Approved concession lever: offer 90-day implementation ramp credits or quarterly phased seat activation instead of headline rate cuts.`,
    },
    {
      id: 'doc-4',
      organisationId: 'org-acme',
      title: 'BioCore Global & Pharma Vertical Case Study',
      fileName: 'pharma-enterprise-case-study.pptx',
      fileType: 'pptx',
      category: 'Case Studies & ROI',
      owner: 'Product Marketing',
      version: 'v1.8',
      reviewDate: '2027-02-15',
      summary:
        'How a Fortune 500 life sciences org migrated off LegacySync in 21 days with 99.99% uptime and 41% lower infra spend.',
      uploadedAt: '2026-11-05T11:00:00Z',
      content: `[Slide 1]
BioCore Global operated 14 regional lab telemetry warehouses on LegacySync Enterprise. Schema changes broke downstream executive dashboards weekly, and manual reconciliation cost 190 engineering hours per month.

[Slide 2]
Using our parallel shadow-sync connector, BioCore ran zero-downtime validation alongside LegacySync for 14 days and completed full cutover in 21 days total.

[Slide 3]
Measured Outcomes: 41% reduction in annual cloud infrastructure and egress spend ($310k saved in Year 1), 99.994% pipeline availability over 12 months, and 6x faster regulatory audit package generation for FDA 21 CFR Part 11 reviews.`,
    },
    {
      id: 'doc-5',
      organisationId: 'org-acme',
      title: 'Objection Handling Playbook: Migration Risk & Timeline',
      fileName: 'objection-migration-playbook.md',
      fileType: 'md',
      category: 'Objection Playbooks',
      owner: 'Sales Enablement',
      version: 'v2.1',
      reviewDate: '2026-12-20',
      summary:
        'Step-by-step counters for migration bandwidth freezes and implementation risk fears.',
      uploadedAt: '2026-11-14T08:30:00Z',
      content: `# Objection: Migration Bandwidth & Q1 Freeze
Prospect Objection: "We're locked into a Q1 freeze and our platform team doesn't have bandwidth for a 4-month rip-and-replace."

# Recommended 3-Step Counter
1. Validate & Isolate: Acknowledge the Q1 freeze and ask what happens if current brittle pipelines slip during Q1 close.
2. Reframe to Parallel Shadow Deployment: Clarify that our deployment does NOT require a rip-and-replace. Our Solutions Engineering team runs a read-only shadow connector in 48 hours using < 4 hours of their team's time.
3. Proof Point: Reference BioCore Global's 21-day zero-downtime cutover with zero production incidents.`,
    },
    {
      id: 'doc-multi-competitor-qa',
      organisationId: 'org-acme',
      title: 'Enterprise QA Multi-Competitor Matrix: BrowserStack, Sauce Labs, Cypress Cloud, Katalon & Tricentis (Mock KB)',
      fileName: 'multi-competitor-qa-matrix.md',
      fileType: 'md',
      category: 'Competitor Battlecards',
      owner: 'Competitive Intelligence',
      version: 'v2.4',
      reviewDate: '2027-02-15',
      sourceMode: 'mock_kb',
      summary:
        'Grounded comparison notes covering BrowserStack, Sauce Labs, Cypress Cloud, Katalon, and Tricentis tradeoffs.',
      uploadedAt: '2026-11-17T08:00:00Z',
      content: `# BrowserStack Tradeoffs
BrowserStack provides broad manual device coverage, but high-concurrency enterprise CI customers report expensive per-parallel-slot add-ons, rigid annual concurrency caps, and limited automated flaky-test quarantine across mixed Playwright/Selenium suites.

# Sauce Labs Tradeoffs
Sauce Labs has legacy enterprise adoption, yet teams migrating to modern Playwright/Cypress pipelines encounter slower container spin-up times, fragmented reporting across legacy Sauce Connect tunnels, and higher total maintenance overhead.

# Cypress Cloud Tradeoffs
Cypress Cloud integrates tightly with Cypress tests, but locks organizations into a single framework—lacking native Selenium, Appium mobile, and cross-framework Playwright trace unification under one governance boundary.

# Katalon & Tricentis Tradeoffs
Katalon and Tricentis emphasize low-code/scripted tooling that often creates vendor lock-in for engineering teams adopting code-first Playwright/TypeScript CI workflows and requires separate infrastructure for high-speed parallel execution.`,
    },
    {
      id: 'doc-nb-1',
      organisationId: 'org-northbridge',
      title: 'Northbridge Zero-Trust Vault Datasheet (Confidential)',
      fileName: 'northbridge-vault-spec.md',
      fileType: 'md',
      category: 'Product Documentation',
      owner: 'Jordan Mercer',
      version: 'v1.0',
      reviewDate: '2027-03-01',
      summary:
        'Tenant-isolated Northbridge Security hardware HSM vault specifications.',
      uploadedAt: '2026-11-15T10:00:00Z',
      content: `# Northbridge Vault HSM
Northbridge Vault provides FIPS 140-3 Level 4 hardware key custody strictly isolated for Northbridge Security customers.`,
    },
  ];

  const knowledgeDocs: KnowledgeDoc[] = [];
  const knowledgeChunks: KnowledgeChunk[] = [];

  const embCfg = getEmbeddingConfig();
  for (const doc of rawDocs) {
    const pieces = chunkTextWithSections(doc.content);
    const words = doc.content.split(/\s+/).filter(Boolean).length;
    knowledgeDocs.push({
      id: doc.id,
      organisationId: doc.organisationId,
      title: doc.title,
      fileName: doc.fileName,
      fileType: doc.fileType,
      category: doc.category,
      owner: doc.owner,
      version: doc.version,
      reviewDate: doc.reviewDate,
      status: 'indexed',
      approvalStatus: 'approved',
      validUntil: doc.reviewDate,
      sensitivity: 'internal',
      checksum: computeSha256(doc.content),
      ingestionStage: 'indexed',
      embeddingModel: embCfg.model,
      embeddingDimension: embCfg.expectedDimension,
      summary: doc.summary,
      wordCount: words,
      chunkCount: pieces.length,
      indexedWithEmbeddings: false,
      uploadedAt: doc.uploadedAt,
      contentPreview: doc.content.slice(0, 260),
      sourceMode: doc.sourceMode || 'mock_kb',
    });

    pieces.forEach((piece, idx) => {
      knowledgeChunks.push({
        id: `${doc.id}-chunk-${idx + 1}`,
        organisationId: doc.organisationId,
        docId: doc.id,
        docTitle: doc.title,
        category: doc.category,
        sectionTitle: piece.sectionTitle,
        headingPath: piece.headingPath,
        pageNumber: piece.pageNumber,
        tokenCount: piece.tokenCount,
        isAtomicFact: piece.isAtomicFact,
        chunkIndex: idx,
        content: piece.content,
      });
    });
  }

  const battlecards: Battlecard[] = [
    {
      id: 'bc-lambdatest',
      organisationId: 'org-acme',
      competitorName: 'LambdaTest',
      aliases: ['Lambda Test', 'LambdaTest Cloud'],
      tagline: 'Lower entry seat pricing offset by flaky-test triage overhead and shared queue latency',
      winRatePct: 71,
      dealsTracked: 22,
      avgDiscountPressurePct: 11,
      theirStrengths: [
        'Low entry-level cloud grid pricing for small teams',
        'Broad catalog of legacy real-device and browser combinations',
      ],
      theirWeaknesses: [
        'Shared grid concurrency queues add 4–9 minutes per CI build during peak hours',
        'No automated flaky-test root-cause clustering (12–18 hrs/wk manual QA triage)',
        'Local tunnel daemons require restarts under high parallel microservices traffic',
      ],
      ourDifferentiators: [
        'Sub-15-second cold-start isolated browser pods with zero shared-grid contention',
        'Automated flaky-test quarantine and trace clustering cuts QA triage by 60%',
        'Drop-in Playwright/Selenium/Cypress adapters with zero test rewrites',
      ],
      landmineQuestions: [
        'How many engineering hours per week does your QA team spend re-running and triaging flaky tests on LambdaTest?',
        'What is your average CI wait time before a pull request gets green-lit during peak release days?',
      ],
      prohibitedClaims: [
        'Do not claim LambdaTest lacks Playwright or Selenium support—focus strictly on queue latency, tunnel stability, and flaky-test triage cost.',
      ],
      pricingCounterStrategy:
        'Acknowledge the higher list license, then anchor on engineering hours saved (16+ hrs/wk triage + 42% faster CI feedback). Offer a 14-day parallel pilot to measure ROI before procurement.',
      quickCounters: [
        {
          claim: 'LambdaTest is cheaper and our team already knows it.',
          counter:
            'License cost is only ~20% of QA spend—engineering hours lost to flaky-test re-runs and CI queues make up the rest. FinGrid saw 3.4x ROI in Year 1 after consolidating.',
        },
      ],
      reviewDate: '2027-02-01',
      updatedAt: '2026-11-16T10:15:00Z',
    },
    {
      id: 'bc-apexcloud',
      organisationId: 'org-acme',
      competitorName: 'ApexCloud',
      aliases: ['Apex Cloud', 'Apex', 'AC Telemetry'],
      tagline: 'Low entry license with steep cross-region egress & audit add-on fees',
      winRatePct: 68,
      dealsTracked: 34,
      avgDiscountPressurePct: 14,
      theirStrengths: [
        'Aggressive initial seat pricing ($48/user) for basic tier',
        'Broad legacy partner ecosystem in mid-market',
      ],
      theirWeaknesses: [
        '15-minute batch replication causes stale multi-region telemetry',
        '$0.14/GB cross-region egress surcharges escalate TCO by 2.1x at scale',
        'Requires $45k/yr Enterprise Audit add-on for >30 day SOC2 log retention',
      ],
      ourDifferentiators: [
        'Sub-180ms p99 zero-copy streaming pipeline across regions',
        'Unlimited cross-region failover & 7-year immutable audit logs included',
        'Automated schema-drift protection eliminates manual ETL maintenance',
      ],
      landmineQuestions: [
        'How does ApexCloud handle real-time RPO across regions without triggering egress multipliers?',
        'What happens to your query p99 SLA once concurrent executive users pass 250?',
      ],
      prohibitedClaims: [
        'Never claim ApexCloud lacks SOC2 Type II entirely—only note their >30-day audit retention requires a $45k add-on.',
      ],
      pricingCounterStrategy:
        'Refuse headline seat-price matching. Present the 3-Year TCO calculator showing ApexCloud egress + audit add-ons exceed our all-in Enterprise tier by 31% in Year 2.',
      quickCounters: [
        {
          claim: 'ApexCloud quoted us 30% lower per seat.',
          counter:
            'Their base seat excludes cross-region egress ($0.14/GB) and 7-year SOC2 retention ($45k/yr). When modeled at your 4TB monthly volume, our all-in TCO is 24% lower.',
        },
        {
          claim: 'ApexCloud says their batch sync is "near real-time".',
          counter:
            'Their architecture runs 15-minute micro-batches. In regulated workflows, a 15-minute blind spot breaks live SLA alerting—ours streams under 180ms p99.',
        },
      ],
      reviewDate: '2026-12-15',
      updatedAt: '2026-11-15T10:00:00Z',
    },
    {
      id: 'bc-legacysync',
      organisationId: 'org-acme',
      competitorName: 'LegacySync Enterprise',
      aliases: ['LegacySync', 'Legacy Sync', 'LS Enterprise'],
      tagline: 'Heavy on-prem heritage requiring 2+ FTE engineers for connector upkeep',
      winRatePct: 74,
      dealsTracked: 27,
      avgDiscountPressurePct: 9,
      theirStrengths: [
        'Deep incumbency in legacy mainframe & ERP environments',
        'Familiar procurement relationship with older IT teams',
      ],
      theirWeaknesses: [
        'Schema changes break downstream pipelines and require manual scripting',
        '4-to-6 month professional services implementation cycle',
        'No native BYOK key revocation or modern zero-trust isolation',
      ],
      ourDifferentiators: [
        '21-day parallel shadow migration with zero production downtime',
        'Managed schema-drift engine saves ~190 engineering hours/month',
        'Native AWS/GCP BYOK with <60s cryptographic revocation',
      ],
      landmineQuestions: [
        'How many engineering hours per sprint are currently spent fixing broken schema mappings in LegacySync?',
        'Did their renewal quote include the mandatory 18% professional services retainer for v9 upgrades?',
      ],
      prohibitedClaims: [
        'Do not promise custom mainframe COBOL connectors without Solutions Engineering sign-off.',
      ],
      pricingCounterStrategy:
        'Anchor against the $380k/yr hidden engineering maintenance cost (2.5 FTEs) and offer a 90-day parallel shadow ramp so they never pay double licensing during cutover.',
      quickCounters: [
        {
          claim: 'Switching off LegacySync feels too risky before Q1 close.',
          counter:
            'We deploy a read-only shadow connector in 48 hours alongside LegacySync so you validate 100% parity before flipping a single production switch.',
        },
      ],
      reviewDate: '2026-12-31',
      updatedAt: '2026-11-13T15:30:00Z',
    },
    {
      id: 'bc-velocrm',
      organisationId: 'org-acme',
      competitorName: 'VeloCRM',
      aliases: ['Velo', 'Velo CRM'],
      tagline: 'Lightweight sales-ops wrapper lacking enterprise security & scale',
      winRatePct: 81,
      dealsTracked: 19,
      avgDiscountPressurePct: 6,
      theirStrengths: [
        'Fast 1-day self-serve onboarding for small teams (<25 reps)',
        'Polished consumer-style UI for basic call notes',
      ],
      theirWeaknesses: [
        'No HIPAA BAA, no single-tenant isolation, and trains shared models on customer logs',
        'Breaks down above 50 concurrent streams with 4-second transcript lag',
        'Lacks semantic RAG grounding across custom PDF/DOCX playbooks',
      ],
      ourDifferentiators: [
        'Zero-data-retention AI governance with SOC2 Type II & HIPAA BAA Day 1',
        'Live sub-second RAG retrieval across unlimited PDF/DOCX/PPTX battlecards',
        'Strict source validation & abstention when evidence is missing',
      ],
      landmineQuestions: [
        'Has your InfoSec team signed off on VeloCRM retaining call audio in their multi-tenant model training pool?',
        'How do they ground live rep recommendations in your proprietary technical documentation?',
      ],
      prohibitedClaims: [
        'Do not quote VeloCRM enterprise pricing without an active prospect proposal.',
      ],
      pricingCounterStrategy:
        'Position VeloCRM as a departmental note-taker that fails InfoSec review; sell directly to VP Sales + CISO jointly.',
      quickCounters: [
        {
          claim: 'Our reps liked VeloCRM because it seemed lightweight.',
          counter:
            'Lightweight tools stop at call recording. We embed your actual technical docs and competitive battlecards into live calls while passing strict SOC2/HIPAA InfoSec gates.',
        },
      ],
      reviewDate: '2027-01-15',
      updatedAt: '2026-11-11T12:00:00Z',
    },
    {
      id: 'bc-browserstack',
      organisationId: 'org-acme',
      competitorName: 'BrowserStack',
      aliases: ['Browser Stack', 'BS Automate'],
      tagline: 'Strong device catalog, but rigid parallel-slot pricing and limited flaky-test root-cause triage',
      winRatePct: 69,
      dealsTracked: 29,
      avgDiscountPressurePct: 12,
      theirStrengths: [
        'Large legacy real-device cloud catalog for manual QA',
        'Strong brand recognition among distributed QA teams',
      ],
      theirWeaknesses: [
        'Rigid per-parallel-slot pricing spikes sharply during peak CI release bursts',
        'Lacks unified automated flaky-test quarantine across Playwright and Selenium',
        'Dedicated private cloud tunneling requires separate enterprise tier add-ons',
      ],
      ourDifferentiators: [
        'Elastic burst concurrency with zero punitive per-slot overage fees',
        'Unified Playwright + Selenium + Cypress flaky-test clustering & quarantine',
        'Sub-15s isolated pods with built-in SOC2/BYOK CI runners',
      ],
      landmineQuestions: [
        'How often do your developers hit BrowserStack parallel-slot queues during end-of-sprint release freezes?',
        'What percentage of your monthly BrowserStack spend goes toward idle parallel slots reserved just for peak days?',
      ],
      prohibitedClaims: [
        'Never claim BrowserStack lacks real mobile devices—focus on CI concurrency pricing, burst queues, and automated triage.',
      ],
      pricingCounterStrategy:
        'Compare rigid 24/7 parallel-slot reservations against our elastic concurrency pooling—typically cutting peak-hour CI wait times by 50% at lower effective TCO.',
      quickCounters: [
        {
          claim: 'We already have an annual BrowserStack contract.',
          counter:
            'Teams keep BrowserStack for occasional manual device checks while shifting high-volume Playwright/Selenium CI runs to our elastic grid to eliminate slot bottlenecks.',
        },
      ],
      reviewDate: '2027-02-15',
      updatedAt: '2026-11-17T08:00:00Z',
    },
    {
      id: 'bc-saucelabs',
      organisationId: 'org-acme',
      competitorName: 'Sauce Labs',
      aliases: ['SauceLabs', 'Sauce Connect'],
      tagline: 'Legacy Selenium heritage with slower container spin-up and fragmented modern Playwright reporting',
      winRatePct: 73,
      dealsTracked: 18,
      avgDiscountPressurePct: 10,
      theirStrengths: [
        'Deep enterprise footprint in legacy Selenium & Appium shops',
        'Established procurement presence in Fortune 500 QA orgs',
      ],
      theirWeaknesses: [
        'Slower VM/container cold-start adds minutes to rapid Playwright PR feedback',
        'Sauce Connect proxy maintenance creates DevOps overhead across microservices',
        'Fragmented analytics across acquired error-monitoring add-ons',
      ],
      ourDifferentiators: [
        'Sub-15-second cold-start browser pods built for modern CI speed',
        'Zero-daemon outbound mTLS connectivity with automated tunnel health checks',
        'Single unified trace, video, and network timeline per commit',
      ],
      landmineQuestions: [
        'How much DevOps time goes into upgrading and troubleshooting Sauce Connect tunnels across staging environments?',
        'Are developers waiting >10 minutes for Playwright PR checks on Sauce Labs?',
      ],
      prohibitedClaims: [
        'Do not claim Sauce Labs lacks Playwright support; focus on cold-start speed, tunnel maintenance, and unified reporting.',
      ],
      pricingCounterStrategy:
        'Anchor on developer velocity and DevOps tunnel maintenance savings; offer a 14-day side-by-side CI speed benchmark.',
      quickCounters: [
        {
          claim: 'Sauce Labs is already approved by our enterprise procurement.',
          counter:
            'We pass the same SOC2 Type II / SSO gates and cut Playwright PR runtime by 40%+ in a zero-risk 14-day shadow benchmark.',
        },
      ],
      reviewDate: '2027-02-15',
      updatedAt: '2026-11-17T08:00:00Z',
    },
    {
      id: 'bc-cypress',
      organisationId: 'org-acme',
      competitorName: 'Cypress Cloud',
      aliases: ['Cypress', 'Cypress Dashboard'],
      tagline: 'Single-framework lock-in without multi-framework Playwright/Selenium/mobile unification',
      winRatePct: 76,
      dealsTracked: 15,
      avgDiscountPressurePct: 8,
      theirStrengths: [
        'Polished developer ergonomics for Cypress-only frontend teams',
        'Simple test-replay dashboard for small web apps',
      ],
      theirWeaknesses: [
        'Locked to Cypress framework—cannot govern Playwright, Selenium, or native mobile in one plane',
        'Per-test-result usage billing becomes unpredictable as suite volume grows',
        'Teams still need a separate grid vendor for Safari/mobile/cross-domain tests',
      ],
      ourDifferentiators: [
        'Run Cypress, Playwright, and Selenium under one unified orchestration & flake-triage plane',
        'Predictable tiering without per-test-execution overage surprises',
        'Full Safari/WebKit and multi-tab auth flow support included',
      ],
      landmineQuestions: [
        'How are you orchestrating backend API, Playwright, or Safari/mobile suites that sit outside Cypress Cloud?',
      ],
      prohibitedClaims: [
        'Never dismiss Cypress developer UX; highlight single-vendor consolidation across frameworks.',
      ],
      pricingCounterStrategy:
        'Show consolidation savings when replacing separate Cypress Cloud + cross-browser grid subscriptions.',
      quickCounters: [],
      reviewDate: '2027-02-15',
      updatedAt: '2026-11-17T08:00:00Z',
    },
    {
      id: 'bc-katalon',
      organisationId: 'org-acme',
      competitorName: 'Katalon',
      aliases: ['Katalon Studio', 'Katalon TestOps'],
      tagline: 'Low-code proprietary scripting that creates friction with Git-native TypeScript/Playwright engineering',
      winRatePct: 78,
      dealsTracked: 11,
      avgDiscountPressurePct: 9,
      theirStrengths: [
        'Accessible low-code recorder for non-developer QA analysts',
      ],
      theirWeaknesses: [
        'Proprietary project lock-in slows code-first CI/CD reviews in GitHub/GitLab',
        'Requires separate runtime engine licenses for headless CI scaling',
      ],
      ourDifferentiators: [
        'Pure open-standard Playwright/Selenium/Cypress execution with zero proprietary script lock-in',
        'Native GitHub Actions, GitLab CI, and Jenkins PR gates',
      ],
      landmineQuestions: [
        'Do your software engineers refuse to review or maintain proprietary Katalon test scripts in pull requests?',
      ],
      prohibitedClaims: [],
      pricingCounterStrategy:
        'Highlight eliminating Katalon Runtime Engine per-node fees and unblocking developer-owned PR testing.',
      quickCounters: [],
      reviewDate: '2027-02-15',
      updatedAt: '2026-11-17T08:00:00Z',
    },
    {
      id: 'bc-tricentis',
      organisationId: 'org-acme',
      competitorName: 'Tricentis',
      aliases: ['Tricentis Tosca', 'Tosca', 'Testim'],
      tagline: 'Heavy enterprise licensing & specialist-only maintenance vs modern developer-speed CI',
      winRatePct: 75,
      dealsTracked: 14,
      avgDiscountPressurePct: 10,
      theirStrengths: [
        'Strong SAP/legacy ERP coverage in large enterprises',
      ],
      theirWeaknesses: [
        'High per-seat specialist licensing and multi-month onboarding overhead',
        'Slower feedback loops for fast-shipping cloud microservices teams',
      ],
      ourDifferentiators: [
        '21-day self-serve + SE shadow onboarding with open-standard CI suites',
        'Sub-minute PR gating for modern SaaS and FinTech releases',
      ],
      landmineQuestions: [
        'How quickly can a product engineer add or debug a failing test inside your sprint without waiting on a Tosca specialist?',
      ],
      prohibitedClaims: [],
      pricingCounterStrategy:
        'Position for cloud product engineering velocity while coexisting with legacy SAP systems if needed.',
      quickCounters: [],
      reviewDate: '2027-02-15',
      updatedAt: '2026-11-17T08:00:00Z',
    },
    {
      id: 'bc-nb-cipher',
      organisationId: 'org-northbridge',
      competitorName: 'CipherVault',
      aliases: ['Cipher Vault'],
      tagline: 'Isolated Northbridge tenant battlecard',
      winRatePct: 72,
      dealsTracked: 8,
      avgDiscountPressurePct: 7,
      theirStrengths: ['Cloud-native KMS wrapper'],
      theirWeaknesses: ['No FIPS 140-3 Level 4 hardware HSM option'],
      ourDifferentiators: ['FIPS 140-3 Level 4 custody'],
      landmineQuestions: ['Do your regulators mandate FIPS 140-3 Level 4 hardware boundaries?'],
      prohibitedClaims: [],
      pricingCounterStrategy: 'Anchor on compliance audit avoidance.',
      quickCounters: [],
      reviewDate: '2027-02-01',
      updatedAt: '2026-11-15T10:00:00Z',
    },
  ];

  const meetings: MeetingSession[] = [
    {
      id: 'mtg-demo-lambdatest',
      organisationId: 'org-acme',
      title: 'FinTech QA Modernization — Live Evaluation (LambdaTest)',
      accountName: 'Beacon Payments QA',
      platform: 'Simulator',
      dealValue: 240000,
      stage: 'Discovery',
      status: 'created',
      captureConsentConfirmed: true,
      aeName: 'Elena Vance',
      prospectStakeholders: ['Samira Patel (VP Quality Engineering)'],
      primaryCompetitor: 'LambdaTest',
      startedAt: new Date().toISOString(),
      durationMinutes: 0,
      aeTalkRatio: 0,
      prospectTalkRatio: 0,
      sentimentTrend: [60],
      qualification: [
        { field: 'Metrics', covered: false },
        { field: 'Economic Buyer', covered: false },
        { field: 'Decision Criteria', covered: false },
        { field: 'Decision Process', covered: false },
        { field: 'Identify Pain', covered: false },
        { field: 'Champion', covered: false },
        { field: 'Competition', covered: false },
      ],
      transcript: [],
      signals: [],
      insights: [],
      scratchpad: [],
      suppressedDuplicatesCount: 0,
    },
    {
      id: 'mtg-101',
      organisationId: 'org-acme',
      title: 'Vanguard BioSystems — Technical Validation & Architecture Review',
      accountName: 'Vanguard BioSystems',
      platform: 'Simulator',
      dealValue: 420000,
      stage: 'Technical Validation',
      status: 'active',
      captureConsentConfirmed: true,
      aeName: 'Elena Vance',
      prospectStakeholders: ['Marcus Chen (VP Engineering)', 'Priya Nair (Head of InfoSec)'],
      primaryCompetitor: 'ApexCloud',
      startedAt: '2026-11-17T09:30:00Z',
      durationMinutes: 24,
      aeTalkRatio: 38,
      prospectTalkRatio: 62,
      sentimentTrend: [58, 62, 55, 67, 71, 64, 76, 74],
      qualification: [
        { field: 'Metrics', covered: true, evidence: '4TB monthly cross-region volume & SLA targets' },
        { field: 'Economic Buyer', covered: false },
        { field: 'Decision Criteria', covered: true, evidence: 'BYOK key revocation & zero model training' },
        { field: 'Decision Process', covered: false },
        { field: 'Identify Pain', covered: true, evidence: 'Regional sync latency for lab alerts' },
        { field: 'Champion', covered: true, evidence: 'Marcus Chen leading technical validation' },
        { field: 'Competition', covered: true, evidence: 'ApexCloud proposal on the table' },
      ],
      transcript: [
        {
          id: 'turn-1',
          speaker: 'AE',
          speakerName: 'Elena Vance',
          text: 'Thanks for making time today, Marcus and Priya. Our goal is to validate your multi-region telemetry latency targets and walk through our SOC2 Type II security boundary.',
          timestamp: '09:31:12',
          detectedTags: ['Agenda Alignment'],
          sentimentScore: 0.65,
        },
        {
          id: 'turn-2',
          speaker: 'Prospect',
          speakerName: 'Marcus Chen',
          text: 'Appreciate that. Honestly, we already have a proposal on the table from ApexCloud. Their per-seat quote came in noticeably lower, and they claim their regional sync is fast enough for our lab alerts.',
          timestamp: '09:33:04',
          detectedTags: ['Competitor: ApexCloud', 'Objection: Price / budget'],
          sentimentScore: -0.25,
        },
        {
          id: 'turn-3',
          speaker: 'AE',
          speakerName: 'Elena Vance',
          text: 'That makes total sense to evaluate side by side. When ApexCloud modeled your 4TB monthly cross-region volume, did they break out their $0.14/GB egress line item and the audit retention add-on?',
          timestamp: '09:34:40',
          detectedTags: ['Differentiation: TCO'],
          sentimentScore: 0.45,
        },
        {
          id: 'turn-4',
          speaker: 'Prospect',
          speakerName: 'Priya Nair',
          text: 'Actually no—good catch. Also, from InfoSec: we cannot go live without Customer-Managed Keys and a guarantee that our clinical trial transcripts never train external AI models.',
          timestamp: '09:36:18',
          detectedTags: ['Objection: Security / compliance', 'Buying Signal'],
          sentimentScore: 0.2,
        },
      ],
      signals: [
        {
          id: 'sig-101',
          organisationId: 'org-acme',
          meetingId: 'mtg-101',
          signalType: 'competitor',
          category: 'Competition / alternative',
          entityName: 'ApexCloud',
          certainty: 'high',
          explicitOrInferred: 'explicit',
          evidenceExcerpt: 'Honestly, we already have a proposal on the table from ApexCloud.',
          suppressedByCooldown: false,
          createdAt: '09:33:05',
        },
        {
          id: 'sig-102',
          organisationId: 'org-acme',
          meetingId: 'mtg-101',
          signalType: 'objection',
          category: 'Security / compliance',
          certainty: 'high',
          explicitOrInferred: 'explicit',
          evidenceExcerpt: 'we cannot go live without Customer-Managed Keys and a guarantee that our clinical trial transcripts never train external AI models.',
          suppressedByCooldown: false,
          createdAt: '09:36:19',
        },
      ],
      insights: [
        {
          id: 'ins-101',
          organisationId: 'org-acme',
          meetingId: 'mtg-101',
          accountName: 'Vanguard BioSystems',
          category: 'competitor',
          objectionCategory: 'Competition / alternative',
          title: 'Competitor Mentioned: ApexCloud',
          trigger: {
            transcriptExcerpt:
              'we already have a proposal on the table from ApexCloud. Their per-seat quote came in noticeably lower',
            speaker: 'Prospect',
            speakerName: 'Marcus Chen',
            timestamp: '09:33:04',
          },
          interpretation:
            'Marcus is anchoring on ApexCloud base seat price ($48/user) without factoring cross-region egress and audit retention surcharges.',
          certainty: 'high',
          explicitOrInferred: 'explicit',
          suggestedAction:
            'Expose hidden $0.14/GB cross-region egress and $45k/yr audit retention add-ons, then probe regional RPO latency.',
          suggestedResponse:
            'ApexCloud quotes $48/seat upfront, but cross-region egress ($0.14/GB) and >30-day SOC2 log retention ($45k/yr) push their Year-2 TCO 31% higher than our all-in Enterprise tier.',
          discoveryQuestion:
            'When your compliance team audits cross-region data lineage, how does ApexCloud handle real-time RPO without triggering egress multipliers?',
          differentiator: 'Sub-180ms p99 zero-copy streaming vs ApexCloud 15-min batch replication.',
          competitorName: 'ApexCloud',
          supportingSources: [
            {
              documentId: 'doc-1',
              title: 'ApexCloud Competitive Battlecard & Architecture Delta',
              section: 'Hidden Egress & Overage Fees',
              excerpt:
                'ApexCloud quotes a low base seat license ($48/user) but charges $0.14 per GB for cross-region query egress and requires a separate $45k/yr Enterprise Audit add-on.',
            },
          ],
          limitations: [],
          abstained: false,
          fingerprint: 'mtg-101::competitor::apexcloud',
          latencyMs: 1180,
          createdAt: '09:33:06',
          feedback: {
            rating: 'used',
            userId: 'usr-elena',
            userName: 'Elena Vance',
            createdAt: '09:34:45',
          },
          applied: true,
        },
        {
          id: 'ins-102',
          organisationId: 'org-acme',
          meetingId: 'mtg-101',
          accountName: 'Vanguard BioSystems',
          category: 'objection',
          objectionCategory: 'Security / compliance',
          title: 'InfoSec Gate: BYOK & Zero AI Model Training',
          trigger: {
            transcriptExcerpt:
              'we cannot go live without Customer-Managed Keys and a guarantee that our clinical trial transcripts never train external AI models.',
            speaker: 'Prospect',
            speakerName: 'Priya Nair',
            timestamp: '09:36:18',
          },
          interpretation:
            'Priya explicitly defined BYOK and zero model training as hard security go-live requirements.',
          certainty: 'high',
          explicitOrInferred: 'explicit',
          suggestedAction:
            'Confirm AWS/GCP BYOK support with <60s revocation and zero foundation-model retention.',
          suggestedResponse:
            'We support AWS/GCP BYOK with <60-second cryptographic key revocation and single-tenant logical isolation—zero customer data is ever retained or used for model training.',
          discoveryQuestion:
            'Would sharing our SOC2 Type II zero-exception report and BYOK architecture brief today satisfy your InfoSec sign-off ahead of procurement?',
          differentiator:
            'Day-1 HIPAA BAA, SOC2 Type II (4 consecutive zero-exception cycles), and <60s BYOK revocation.',
          supportingSources: [
            {
              documentId: 'doc-2',
              title: 'Enterprise Security, SOC2 Type II & HIPAA Posture',
              section: 'Encryption & Key Ownership',
              excerpt:
                'Enterprise accounts can enable Customer-Managed Keys (BYOK) via AWS KMS or GCP Cloud KMS with instant cryptographic revocation in under 60 seconds.',
            },
          ],
          limitations: [],
          abstained: false,
          fingerprint: 'mtg-101::objection::security-compliance',
          latencyMs: 1320,
          createdAt: '09:36:20',
          feedback: {
            rating: 'helpful',
            userId: 'usr-elena',
            userName: 'Elena Vance',
            createdAt: '09:37:00',
          },
        },
      ],
      scratchpad: [
        {
          id: 'sp-1',
          text: 'Send Priya SOC2 Type II report + BYOK <60s revocation spec right after call.',
          sourceTitle: 'Enterprise Security, SOC2 Type II & HIPAA Posture',
          createdAt: '09:37:05',
        },
      ],
      suppressedDuplicatesCount: 1,
    },
    {
      id: 'mtg-102',
      organisationId: 'org-acme',
      title: 'Meridian Logistics — Commercial Negotiation & CFO Review',
      accountName: 'Meridian Logistics',
      platform: 'Zoom RTMS',
      dealValue: 285000,
      stage: 'Commercial Negotiation',
      status: 'completed',
      captureConsentConfirmed: true,
      aeName: 'Elena Vance',
      prospectStakeholders: ['David Morales (CFO)', 'Hannah Brooks (VP Operations)'],
      primaryCompetitor: 'LegacySync Enterprise',
      startedAt: '2026-11-16T15:00:00Z',
      endedAt: '2026-11-16T15:46:00Z',
      durationMinutes: 46,
      aeTalkRatio: 35,
      prospectTalkRatio: 65,
      sentimentTrend: [60, 58, 65, 70, 74, 79, 81, 84],
      qualification: [
        { field: 'Metrics', covered: true, evidence: '175 engineering hours/month wasted on ERP mappings' },
        { field: 'Economic Buyer', covered: true, evidence: 'David Morales (CFO) engaged' },
        { field: 'Decision Criteria', covered: true },
        { field: 'Decision Process', covered: true, evidence: 'Sign before month-end with 90-day ramp' },
        { field: 'Identify Pain', covered: true },
        { field: 'Champion', covered: true, evidence: 'Hannah Brooks' },
        { field: 'Competition', covered: true, evidence: 'LegacySync Enterprise' },
      ],
      transcript: [
        {
          id: 'm102-t1',
          speaker: 'Prospect',
          speakerName: 'David Morales',
          text: 'Our board is scrutinizing every new SaaS line item. Why should we pay $65k base when LegacySync is already sunk cost?',
          timestamp: '15:12:08',
          detectedTags: ['Objection: Price / budget', 'Competitor: LegacySync Enterprise'],
          sentimentScore: -0.3,
        },
        {
          id: 'm102-t2',
          speaker: 'AE',
          speakerName: 'Elena Vance',
          text: 'Because LegacySync is currently consuming 2.5 FTE engineers on manual schema fixes—nearly $380k/year in hidden opex that disappears in 21 days with our managed pipeline.',
          timestamp: '15:13:20',
          detectedTags: ['ROI Value Anchor'],
          sentimentScore: 0.72,
        },
        {
          id: 'm102-t3',
          speaker: 'Prospect',
          speakerName: 'Hannah Brooks',
          text: 'Confirmed—our platform squad logged 175 hours last month just patching broken ERP mappings. If you can give us a 90-day ramp credit, we can sign before month-end.',
          timestamp: '15:15:44',
          detectedTags: ['Buying Signal'],
          sentimentScore: 0.85,
        },
      ],
      signals: [
        {
          id: 'sig-201',
          organisationId: 'org-acme',
          meetingId: 'mtg-102',
          signalType: 'buying_signal',
          category: 'Timing / priority',
          certainty: 'high',
          explicitOrInferred: 'explicit',
          evidenceExcerpt: 'If you can give us a 90-day ramp credit, we can sign before month-end.',
          suppressedByCooldown: false,
          createdAt: '15:15:45',
        },
      ],
      insights: [
        {
          id: 'ins-201',
          organisationId: 'org-acme',
          meetingId: 'mtg-102',
          accountName: 'Meridian Logistics',
          category: 'buying_signal',
          title: 'Month-End Close Trigger via 90-Day Ramp Credit',
          trigger: {
            transcriptExcerpt:
              'If you can give us a 90-day ramp credit, we can sign before month-end.',
            speaker: 'Prospect',
            speakerName: 'Hannah Brooks',
            timestamp: '15:15:44',
          },
          interpretation:
            'VP Operations confirmed 175 hrs/mo engineering drain and tied month-end signature to an approved 90-day ramp concession.',
          certainty: 'high',
          explicitOrInferred: 'explicit',
          suggestedAction:
            'Offer the approved 90-day implementation ramp credit while holding the $65,000 list base rate.',
          suggestedResponse:
            'We can structure a 90-day parallel shadow ramp credit so you avoid double-paying during cutover while keeping our standard $65k base tier intact.',
          competitorName: 'LegacySync Enterprise',
          supportingSources: [
            {
              documentId: 'doc-3',
              title: 'Commercial Pricing, Volume Tiers & CFO ROI Playbook',
              section: 'Handling Price Objections',
              excerpt:
                'Approved concession lever: offer 90-day implementation ramp credits or quarterly phased seat activation instead of headline rate cuts.',
            },
          ],
          limitations: [],
          abstained: false,
          fingerprint: 'mtg-102::buying_signal::ramp',
          latencyMs: 1090,
          createdAt: '15:16:02',
          feedback: {
            rating: 'used',
            userId: 'usr-elena',
            userName: 'Elena Vance',
            createdAt: '15:17:10',
          },
          applied: true,
        },
      ],
      scratchpad: [],
      suppressedDuplicatesCount: 0,
    },
    {
      id: 'mtg-103',
      organisationId: 'org-acme',
      title: 'Northstar FinTech — Security & Real-Time Risk Pipeline',
      accountName: 'Northstar FinTech',
      platform: 'Zoom RTMS',
      dealValue: 540000,
      stage: 'Security Review',
      status: 'completed',
      captureConsentConfirmed: true,
      aeName: 'Elena Vance',
      prospectStakeholders: ['Liam O’Connor (CISO)', 'Sora Takahashi (Principal Architect)'],
      primaryCompetitor: 'ApexCloud',
      startedAt: '2026-11-15T11:00:00Z',
      endedAt: '2026-11-15T11:52:00Z',
      durationMinutes: 52,
      aeTalkRatio: 41,
      prospectTalkRatio: 59,
      sentimentTrend: [64, 60, 52, 57, 61, 65, 68, 66],
      qualification: [
        { field: 'Metrics', covered: true, evidence: '300 concurrent analysts at market open' },
        { field: 'Economic Buyer', covered: false },
        { field: 'Decision Criteria', covered: true },
        { field: 'Decision Process', covered: false },
        { field: 'Identify Pain', covered: true },
        { field: 'Champion', covered: false },
        { field: 'Competition', covered: true, evidence: 'ApexCloud' },
      ],
      transcript: [
        {
          id: 'm103-t1',
          speaker: 'Prospect',
          speakerName: 'Sora Takahashi',
          text: 'We hit 300 concurrent analysts at market open. ApexCloud promised us sub-second refresh, though we have not stress-tested them past 100 users yet.',
          timestamp: '11:18:22',
          detectedTags: ['Competitor: ApexCloud', 'Risk: Unverified SLA'],
          sentimentScore: 0.1,
        },
      ],
      signals: [
        {
          id: 'sig-301',
          organisationId: 'org-acme',
          meetingId: 'mtg-103',
          signalType: 'risk',
          category: 'Technical / integration',
          entityName: 'ApexCloud',
          certainty: 'high',
          explicitOrInferred: 'explicit',
          evidenceExcerpt: 'We hit 300 concurrent analysts at market open. ApexCloud promised us sub-second refresh',
          suppressedByCooldown: false,
          createdAt: '11:18:24',
        },
      ],
      insights: [
        {
          id: 'ins-301',
          organisationId: 'org-acme',
          meetingId: 'mtg-103',
          accountName: 'Northstar FinTech',
          category: 'risk',
          objectionCategory: 'Technical / integration',
          title: 'Concurrency SLA Gap for ApexCloud at 300 Users',
          trigger: {
            transcriptExcerpt:
              'We hit 300 concurrent analysts at market open. ApexCloud promised us sub-second refresh, though we have not stress-tested them past 100 users yet.',
            speaker: 'Prospect',
            speakerName: 'Sora Takahashi',
            timestamp: '11:18:22',
          },
          interpretation:
            'Prospect has not verified ApexCloud concurrency past 100 users while requiring 300 concurrent dashboards at market open.',
          certainty: 'high',
          explicitOrInferred: 'explicit',
          suggestedAction:
            'Propose a 48-hour 300-user load test and ask for ApexCloud contractual p99 SLAs above 250 dashboards.',
          discoveryQuestion:
            'Have they shared contractual SLAs on query p99 latency once concurrent dashboards exceed 250 users?',
          competitorName: 'ApexCloud',
          supportingSources: [
            {
              documentId: 'doc-1',
              title: 'ApexCloud Competitive Battlecard & Architecture Delta',
              section: 'Landmine Discovery Questions',
              excerpt:
                'Have they shared contractual SLAs on query p99 latency once concurrent dashboards exceed 250 users?',
            },
          ],
          limitations: [],
          abstained: false,
          fingerprint: 'mtg-103::risk::apexcloud',
          latencyMs: 1410,
          createdAt: '11:18:30',
          feedback: {
            rating: 'helpful',
            userId: 'usr-elena',
            userName: 'Elena Vance',
            createdAt: '11:20:00',
          },
        },
      ],
      scratchpad: [],
      suppressedDuplicatesCount: 0,
    },
    {
      id: 'mtg-104',
      organisationId: 'org-acme',
      title: 'Kestrel Aerospace — Executive Alignment & Rollout Plan',
      accountName: 'Kestrel Aerospace',
      platform: 'Simulator',
      dealValue: 680000,
      stage: 'Executive Alignment',
      status: 'created',
      captureConsentConfirmed: false,
      aeName: 'Elena Vance',
      prospectStakeholders: ['Claire Sterling (CRO)', 'Victor Alvarez (VP IT)'],
      primaryCompetitor: 'VeloCRM',
      startedAt: '2026-11-17T14:00:00Z',
      durationMinutes: 0,
      aeTalkRatio: 0,
      prospectTalkRatio: 0,
      sentimentTrend: [70, 72, 75, 78, 79],
      qualification: [
        { field: 'Metrics', covered: false },
        { field: 'Economic Buyer', covered: true, evidence: 'Claire Sterling (CRO)' },
        { field: 'Decision Criteria', covered: false },
        { field: 'Decision Process', covered: false },
        { field: 'Identify Pain', covered: false },
        { field: 'Champion', covered: false },
        { field: 'Competition', covered: true, evidence: 'VeloCRM' },
      ],
      transcript: [],
      signals: [],
      insights: [],
      scratchpad: [],
      suppressedDuplicatesCount: 0,
    },
    {
      id: 'mtg-nb-1',
      organisationId: 'org-northbridge',
      title: 'Northbridge Pilot — HSM Custody Validation',
      accountName: 'Helios Defense Corp',
      platform: 'Simulator',
      dealValue: 195000,
      stage: 'Discovery',
      status: 'active',
      captureConsentConfirmed: true,
      aeName: 'Jordan Mercer',
      prospectStakeholders: ['CISO Office'],
      primaryCompetitor: 'CipherVault',
      startedAt: '2026-11-17T08:00:00Z',
      durationMinutes: 12,
      aeTalkRatio: 40,
      prospectTalkRatio: 60,
      sentimentTrend: [65, 68, 70],
      qualification: [
        { field: 'Budget', covered: false },
        { field: 'Authority', covered: true },
        { field: 'Need', covered: true },
        { field: 'Timeline', covered: false },
      ],
      transcript: [],
      signals: [],
      insights: [],
      scratchpad: [],
      suppressedDuplicatesCount: 0,
    },
  ];

  const auditEvents: AuditEvent[] = [
    {
      id: 'aud-1',
      organisationId: 'org-acme',
      actorName: 'Sarah Lin',
      actorRole: 'Knowledge Manager',
      action: 'knowledge.indexed',
      resource: 'ApexCloud Competitive Battlecard & Architecture Delta (v3.2)',
      createdAt: '2026-11-10T14:21:00Z',
    },
    {
      id: 'aud-2',
      organisationId: 'org-acme',
      actorName: 'Elena Vance',
      actorRole: 'Organisation Admin',
      action: 'privacy.retention_updated',
      resource: 'Transcript retention set to 90 days · Cooldown 45s',
      createdAt: '2026-11-12T09:00:00Z',
    },
  ];

  const stakeholders: StakeholderProfile[] = [
    {
      id: 'stk-samira-patel',
      organisationId: 'org-acme',
      name: 'Samira Patel',
      role: 'VP Quality Engineering',
      accountName: 'Beacon Payments QA',
      buyingRole: 'Technical Evaluator',
      email: 'samira.patel@beaconpayments.io',
      focusAreas: ['CI/CD parallelization', 'Flaky test reduction', 'Grid TCO'],
      priorInteractions: [
        {
          id: 'int-samira-1',
          meetingTitle: 'Initial QA Platform Discovery & Pain Mapping',
          accountName: 'Beacon Payments QA',
          date: '2026-11-11',
          channel: 'Discovery Call',
          summary:
            'Flagged nightly Playwright queue bottlenecks on LambdaTest and asked for an enterprise concurrency TCO comparison.',
          keyExcerpt: 'Our release train waits 42 minutes on cross-browser runs every evening.',
          sentiment: 'positive',
        },
        {
          id: 'int-samira-2',
          meetingTitle: 'GitHub Actions & Jira Integration Architecture Follow-Up',
          accountName: 'Beacon Payments QA',
          date: '2026-11-14',
          channel: 'Email Thread',
          summary:
            'Requested confirmation of native GitHub Actions shard orchestration and automated Jira defect links ahead of the live evaluation.',
          sentiment: 'neutral',
        },
      ],
    },
    {
      id: 'stk-marcus-chen',
      organisationId: 'org-acme',
      name: 'Marcus Chen',
      role: 'VP Engineering',
      accountName: 'Vanguard BioSystems',
      buyingRole: 'Technical Evaluator',
      email: 'm.chen@vanguardbio.com',
      focusAreas: ['Sub-50ms streaming latency', 'VPC deployment', 'Migration effort'],
      priorInteractions: [
        {
          id: 'int-marcus-1',
          meetingTitle: 'Vanguard BioSystems — Architecture & Scale Scoping',
          accountName: 'Vanguard BioSystems',
          date: '2026-11-05',
          channel: 'Technical Scoping',
          summary:
            'Reviewed ingestion throughput targets (140k events/sec) and benchmarked ApexCloud batch lag against our streaming engine.',
          keyExcerpt: 'If migration takes more than one sprint, engineering cannot sponsor it this quarter.',
          sentiment: 'cautious',
        },
        {
          id: 'int-marcus-2',
          meetingTitle: 'Sandbox Benchmark Access & SDK Walkthrough',
          accountName: 'Vanguard BioSystems',
          date: '2026-11-12',
          channel: 'Workshop',
          summary:
            'Validated sub-50ms p99 latency on synthetic genomic telemetry datasets with his platform engineering leads.',
          sentiment: 'positive',
        },
      ],
    },
    {
      id: 'stk-priya-nair',
      organisationId: 'org-acme',
      name: 'Priya Nair',
      role: 'Head of InfoSec',
      accountName: 'Vanguard BioSystems',
      buyingRole: 'Security Reviewer',
      email: 'priya.nair@vanguardbio.com',
      focusAreas: ['SOC2 Type II', 'HIPAA BAA', 'AWS KMS BYOK'],
      priorInteractions: [
        {
          id: 'int-priya-1',
          meetingTitle: 'InfoSec Questionnaire & Trust Center Review',
          accountName: 'Vanguard BioSystems',
          date: '2026-11-09',
          channel: 'Security Review',
          summary:
            'Verified SOC2 Type II bridge letter and requested AWS KMS customer-managed key rotation documentation.',
          keyExcerpt: 'No production PHI or clinical metadata can leave our VPC without BYOK.',
          sentiment: 'cautious',
        },
      ],
    },
    {
      id: 'stk-david-morales',
      organisationId: 'org-acme',
      name: 'David Morales',
      role: 'CFO',
      accountName: 'Meridian Logistics',
      buyingRole: 'Economic Buyer',
      email: 'dmorales@meridianlogistics.com',
      focusAreas: ['3-year TCO', 'Payback period', 'Annual contract caps'],
      priorInteractions: [
        {
          id: 'int-david-1',
          meetingTitle: 'Meridian Logistics — Executive Business Case Briefing',
          accountName: 'Meridian Logistics',
          date: '2026-11-06',
          channel: 'Executive Call',
          summary:
            'Requested a board-ready ROI model comparing our bundled platform fee against ApexCloud overage charges.',
          keyExcerpt: 'Show me payback inside two quarters and I can unlock Q4 budget.',
          sentiment: 'cautious',
        },
      ],
    },
    {
      id: 'stk-hannah-brooks',
      organisationId: 'org-acme',
      name: 'Hannah Brooks',
      role: 'VP Operations',
      accountName: 'Meridian Logistics',
      buyingRole: 'Champion',
      email: 'hannah.brooks@meridianlogistics.com',
      focusAreas: ['Dispatch SLA visibility', 'Warehouse rollout', 'Ops automation'],
      priorInteractions: [
        {
          id: 'int-hannah-1',
          meetingTitle: 'Regional Hub Pilot Kickoff & Success Criteria',
          accountName: 'Meridian Logistics',
          date: '2026-10-29',
          channel: 'Discovery Call',
          summary:
            'Defined pilot KPIs across 4 Midwest distribution hubs and sponsored internal intro to CFO David Morales.',
          sentiment: 'positive',
        },
        {
          id: 'int-hannah-2',
          meetingTitle: 'Pilot Readout: 31% Faster Exception Triage',
          accountName: 'Meridian Logistics',
          date: '2026-11-10',
          channel: 'Pilot Review',
          summary:
            'Confirmed team adoption and co-authored the commercial business case ahead of the CFO negotiation call.',
          sentiment: 'positive',
        },
      ],
    },
    {
      id: 'stk-liam-oconnor',
      organisationId: 'org-acme',
      name: 'Liam O’Connor',
      role: 'CISO',
      accountName: 'Northstar FinTech',
      buyingRole: 'Security Reviewer',
      email: 'liam.oconnor@northstarfintech.com',
      focusAreas: ['PCI-DSS isolation', 'Zero-trust PrivateLink', 'Audit logging'],
      priorInteractions: [
        {
          id: 'int-liam-1',
          meetingTitle: 'Northstar FinTech — Zero-Trust & PrivateLink Pre-Audit',
          accountName: 'Northstar FinTech',
          date: '2026-11-04',
          channel: 'Security Briefing',
          summary:
            'Approved tenant-isolated data residency posture pending immutable audit trail verification.',
          sentiment: 'neutral',
        },
      ],
    },
    {
      id: 'stk-sora-takahashi',
      organisationId: 'org-acme',
      name: 'Sora Takahashi',
      role: 'Principal Architect',
      accountName: 'Northstar FinTech',
      buyingRole: 'Technical Evaluator',
      email: 'sora.t@northstarfintech.com',
      focusAreas: ['Fraud scoring pipelines', 'Event replay', 'Kafka connectors'],
      priorInteractions: [
        {
          id: 'int-sora-1',
          meetingTitle: 'Real-Time Risk Scoring Throughput Benchmark',
          accountName: 'Northstar FinTech',
          date: '2026-11-08',
          channel: 'Technical Deep Dive',
          summary:
            'Tested Kafka consumer group failover and verified zero duplicate alert emissions under load.',
          keyExcerpt: 'Latency consistency during burst market hours is our make-or-break criterion.',
          sentiment: 'positive',
        },
      ],
    },
    {
      id: 'stk-claire-sterling',
      organisationId: 'org-acme',
      name: 'Claire Sterling',
      role: 'CRO',
      accountName: 'Kestrel Aerospace',
      buyingRole: 'Executive Sponsor',
      email: 'c.sterling@kestrelaero.com',
      focusAreas: ['Global AE ramp time', 'Competitive win rate', 'Q1 rollout'],
      priorInteractions: [
        {
          id: 'int-claire-1',
          meetingTitle: 'Kestrel Aerospace — Revenue Enablement Alignment',
          accountName: 'Kestrel Aerospace',
          date: '2026-11-12',
          channel: 'Executive Briefing',
          summary:
            'Shared FY27 competitive win-rate goals against VeloCRM and requested a phased 60-rep onboarding timeline.',
          sentiment: 'positive',
        },
      ],
    },
    {
      id: 'stk-victor-alvarez',
      organisationId: 'org-acme',
      name: 'Victor Alvarez',
      role: 'VP IT',
      accountName: 'Kestrel Aerospace',
      buyingRole: 'Technical Evaluator',
      email: 'valvarez@kestrelaero.com',
      focusAreas: ['Okta SAML/SCIM', 'CRM data governance', 'Endpoint security'],
      priorInteractions: [
        {
          id: 'int-victor-1',
          meetingTitle: 'Enterprise Identity & Governance Checklist',
          accountName: 'Kestrel Aerospace',
          date: '2026-11-13',
          channel: 'IT Review',
          summary:
            'Reviewed Okta SSO setup and requested confirmation that no external meeting bots join internal executive calls.',
          sentiment: 'neutral',
        },
      ],
    },
    {
      id: 'stk-ciso-office',
      organisationId: 'org-northbridge',
      name: 'CISO Office',
      role: 'Security Governance',
      accountName: 'Helios Defense Corp',
      buyingRole: 'Security Reviewer',
      focusAreas: ['HSM key custody', 'Air-gapped retention', 'Compliance sign-off'],
      priorInteractions: [
        {
          id: 'int-ciso-1',
          meetingTitle: 'Helios Defense — HSM Custody Pre-Assessment',
          accountName: 'Helios Defense Corp',
          date: '2026-11-10',
          channel: 'Security Review',
          summary:
            'Evaluated FIPS 140-3 HSM key custody requirements against CipherVault baseline.',
          sentiment: 'neutral',
        },
      ],
    },
  ];

  return {
    organisations,
    users,
    auditEvents,
    meetings,
    stakeholders,
    knowledgeDocs,
    knowledgeChunks,
    battlecards,
  };
}

class SalesStore {
  private state: StoreState;
  private indexingInFlight = false;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      try {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<StoreState>;
        // Upgrade cleanly if older prototype schema exists on disk
        if (!parsed.organisations || !parsed.users || !parsed.auditEvents) {
          this.state = createSeedState();
          this.save();
        } else {
          this.state = parsed as StoreState;
          this.ensureDemoRecordsPresent();
        }
      } catch {
        this.state = createSeedState();
        this.save();
      }
    } else {
      this.state = createSeedState();
      this.save();
    }
  }

  private ensureDemoRecordsPresent(): void {
    const seed = createSeedState();
    let changed = false;

    for (const doc of seed.knowledgeDocs) {
      if (!this.state.knowledgeDocs.some((d) => d.id === doc.id)) {
        this.state.knowledgeDocs.push(doc);
        changed = true;
      }
    }
    for (const chunk of seed.knowledgeChunks) {
      if (!this.state.knowledgeChunks.some((c) => c.id === chunk.id)) {
        this.state.knowledgeChunks.push(chunk);
        changed = true;
      }
    }
    for (const bc of seed.battlecards) {
      if (!this.state.battlecards.some((b) => b.id === bc.id)) {
        this.state.battlecards.unshift(bc);
        changed = true;
      }
    }
    const demoMtg = seed.meetings.find((m) => m.id === 'mtg-demo-lambdatest');
    if (demoMtg && !this.state.meetings.some((m) => m.id === demoMtg.id)) {
      this.state.meetings.unshift(demoMtg);
      changed = true;
    }

    if (!Array.isArray(this.state.stakeholders)) {
      this.state.stakeholders = [];
      changed = true;
    }
    for (const stk of seed.stakeholders) {
      if (!this.state.stakeholders.some((s) => s.id === stk.id)) {
        this.state.stakeholders.push(stk);
        changed = true;
      }
    }

    if (!this.state.preferencesByUser) {
      this.state.preferencesByUser = {};
      changed = true;
    }

    // Backfill v0.5 governance metadata on legacy docs/chunks
    const embCfg = getEmbeddingConfig();
    for (const doc of this.state.knowledgeDocs) {
      if (!doc.approvalStatus) {
        doc.approvalStatus = 'approved';
        changed = true;
      }
      if (!doc.sensitivity) {
        doc.sensitivity = 'internal';
        changed = true;
      }
      if (!doc.ingestionStage) {
        doc.ingestionStage = doc.status === 'indexed' ? 'indexed' : 'chunked';
        changed = true;
      }
      if (!doc.embeddingModel) {
        doc.embeddingModel = embCfg.model;
        doc.embeddingDimension = embCfg.expectedDimension;
        changed = true;
      }
    }
    for (const chunk of this.state.knowledgeChunks) {
      if (typeof chunk.tokenCount !== 'number') {
        chunk.tokenCount = estimateTokens(chunk.content);
        changed = true;
      }
    }

    // Enforce privacy-first transcript retention on startup (never retain indefinitely)
    const purged = this.enforceTranscriptRetention(Date.now(), false);
    if (purged > 0) {
      changed = true;
    }

    if (changed) {
      this.save();
    }
  }

  private getEffectiveRetentionDays(organisationId: string): number {
    let envDays = 0;
    try {
      envDays = getTranscriptRetentionDays();
    } catch {
      envDays = 0;
    }
    const org = this.state.organisations.find((o) => o.id === organisationId);
    const orgDays = typeof org?.settings?.retentionDays === 'number' ? org.settings.retentionDays : envDays;
    // Environment TRANSCRIPT_RETENTION_DAYS acts as a strict upper privacy ceiling
    return Math.max(0, Math.min(365, Math.min(envDays, orgDays)));
  }

  /**
   * Enforces privacy-first transcript retention:
   * - Effective days === 0: purges raw transcripts from all completed meetings immediately (ephemeral mode).
   * - Effective days 1..365: purges raw transcripts from completed meetings older than N days.
   * Preserves structured conversationState, executiveSummary, insights, and signals.
   */
  enforceTranscriptRetention(nowMs = Date.now(), persistIfChanged = true): number {
    let purgedMeetings = 0;
    for (const meeting of this.state.meetings) {
      if (!meeting.transcript || meeting.transcript.length === 0) continue;
      if (meeting.status !== 'completed') continue;

      const effectiveDays = this.getEffectiveRetentionDays(meeting.organisationId);
      const refIso = meeting.endedAt || meeting.startedAt;
      const refMs = Date.parse(refIso);
      const ageMs = Number.isFinite(refMs) ? Math.max(0, nowMs - refMs) : Infinity;

      if (effectiveDays === 0 || ageMs >= effectiveDays * 24 * 60 * 60 * 1000) {
        meeting.transcript = [];
        purgedMeetings += 1;
      }
    }

    if (purgedMeetings > 0) {
      logger.info(
        'Retention',
        `Purged raw transcripts from ${purgedMeetings} completed meeting(s) under privacy retention policy.`,
      );
      if (persistIfChanged) {
        this.save();
      }
    }
    return purgedMeetings;
  }

  save(): void {
    // When effective retention is 0 days (ephemeral), NEVER persist raw transcripts to disk.
    const serializedState: StoreState = {
      ...this.state,
      meetings: this.state.meetings.map((m) => {
        const effectiveDays = this.getEffectiveRetentionDays(m.organisationId);
        if (effectiveDays === 0 && m.transcript.length > 0) {
          return { ...m, transcript: [] };
        }
        return m;
      }),
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(serializedState, null, 2), 'utf-8');
  }

  getPreferences(userKey: string): CopilotPreferences {
    const existing = this.state.preferencesByUser?.[userKey];
    if (existing) return existing;
    return {
      density: 'standard',
      hudPosition: 'bottom-right',
      hudOpacity: 96,
      showSourcesExpanded: false,
      updatedAt: new Date().toISOString(),
    };
  }

  updatePreferences(
    userKey: string,
    patch: Partial<CopilotPreferences>,
  ): CopilotPreferences {
    if (!this.state.preferencesByUser) {
      this.state.preferencesByUser = {};
    }
    const current = this.getPreferences(userKey);
    const updated: CopilotPreferences = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.state.preferencesByUser[userKey] = updated;
    this.save();
    return updated;
  }

  resetMeeting(meetingId: string, orgId: string): MeetingSession | null {
    const meeting = this.state.meetings.find(
      (m) => m.id === meetingId && m.organisationId === orgId,
    );
    if (!meeting) return null;

    meeting.status = 'created';
    meeting.startedAt = new Date().toISOString();
    meeting.endedAt = undefined;
    meeting.durationMinutes = 0;
    meeting.aeTalkRatio = 0;
    meeting.prospectTalkRatio = 0;
    meeting.sentimentTrend = [60];
    meeting.transcript = [];
    meeting.signals = [];
    meeting.insights = [];
    meeting.scratchpad = [];
    meeting.suppressedDuplicatesCount = 0;
    meeting.zoomLink = undefined;
    meeting.executiveSummary = undefined;
    meeting.conversationState = undefined;
    for (const q of meeting.qualification) {
      q.covered = false;
      q.evidence = undefined;
    }
    this.save();
    return meeting;
  }

  getState(): StoreState {
    return this.state;
  }

  getOrganisation(orgId: string): Organisation {
    return (
      this.state.organisations.find((o) => o.id === orgId) || this.state.organisations[0]
    );
  }

  private parseStakeholderLabel(raw: string): { name: string; role: string } {
    const cleaned = raw.trim();
    const match = cleaned.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (match) {
      return {
        name: match[1].trim(),
        role: match[2].trim(),
      };
    }
    return {
      name: cleaned || 'Prospect Stakeholder',
      role: 'Stakeholder',
    };
  }

  private inferBuyingRole(role: string): StakeholderProfile['buyingRole'] {
    const r = role.toLowerCase();
    if (r.includes('cfo') || r.includes('cro') || r.includes('ceo') || r.includes('vp finance')) {
      return 'Economic Buyer';
    }
    if (r.includes('ciso') || r.includes('infosec') || r.includes('security')) {
      return 'Security Reviewer';
    }
    if (
      r.includes('cto') ||
      r.includes('architect') ||
      r.includes('engineering') ||
      r.includes('it') ||
      r.includes('qa') ||
      r.includes('quality')
    ) {
      return 'Technical Evaluator';
    }
    if (r.includes('operations') || r.includes('ops') || r.includes('director')) {
      return 'Champion';
    }
    return 'Stakeholder';
  }

  ensureStakeholdersRegistered(params: {
    organisationId: string;
    accountName: string;
    stakeholderLabels: string[];
  }): void {
    if (!Array.isArray(this.state.stakeholders)) {
      this.state.stakeholders = [];
    }
    for (const label of params.stakeholderLabels) {
      const parsed = this.parseStakeholderLabel(label);
      const normName = parsed.name.toLowerCase();
      const exists = this.state.stakeholders.some(
        (s) => s.organisationId === params.organisationId && s.name.toLowerCase() === normName,
      );
      if (!exists) {
        this.state.stakeholders.push({
          id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          organisationId: params.organisationId,
          name: parsed.name,
          role: parsed.role,
          accountName: params.accountName,
          buyingRole: this.inferBuyingRole(parsed.role),
          focusAreas: [],
          priorInteractions: [],
        });
      }
    }
  }

  getMeetingStakeholders(meetingId: string, organisationId: string): MeetingStakeholderSummary[] {
    const meeting = this.state.meetings.find(
      (m) => m.id === meetingId && m.organisationId === organisationId,
    );
    if (!meeting) return [];

    const orgMeetings = this.state.meetings.filter((m) => m.organisationId === organisationId);
    const orgStakeholders = (this.state.stakeholders || []).filter(
      (s) => s.organisationId === organisationId,
    );

    return meeting.prospectStakeholders.map((rawLabel, idx) => {
      const parsed = this.parseStakeholderLabel(rawLabel);
      const normName = parsed.name.toLowerCase();

      const profile = orgStakeholders.find(
        (s) =>
          s.name.toLowerCase() === normName ||
          rawLabel.toLowerCase().includes(s.name.toLowerCase()),
      );

      const resolvedName = profile?.name || parsed.name;
      const resolvedRole = profile?.role || parsed.role;
      const normResolved = resolvedName.toLowerCase();

      const currentMeetingTurns = meeting.transcript.filter((t) => {
        if (t.speaker === 'Sales Representative' || t.speaker === 'AE') return false;
        const sp = (t.speakerName || '').toLowerCase();
        return sp === normResolved || sp.includes(normResolved);
      }).length;

      // Aggregate real interactions from OTHER meetings in the database
      const meetingHistory: StakeholderInteraction[] = [];
      for (const other of orgMeetings) {
        if (other.id === meeting.id) continue;
        const listedInMeeting = other.prospectStakeholders.some((s) =>
          s.toLowerCase().includes(normResolved),
        );
        const spokenTurns = other.transcript.filter((t) => {
          if (t.speaker === 'Sales Representative' || t.speaker === 'AE') return false;
          const sp = (t.speakerName || '').toLowerCase();
          return sp === normResolved || sp.includes(normResolved);
        });
        if (!listedInMeeting && spokenTurns.length === 0) continue;

        const latestTurn = spokenTurns[spokenTurns.length - 1];
        const summary =
          other.executiveSummary?.facts?.[0] ||
          (spokenTurns.length > 0
            ? `Participated in ${other.stage} (${spokenTurns.length} recorded turn${spokenTurns.length === 1 ? '' : 's'}).`
            : `Scheduled attendee for ${other.stage} (${other.status}).`);

        meetingHistory.push({
          id: `db-mtg-${other.id}-${normResolved.replace(/[^a-z0-9]+/g, '-')}`,
          meetingId: other.id,
          meetingTitle: other.title,
          accountName: other.accountName,
          date: other.startedAt.slice(0, 10),
          channel: other.platform === 'Simulator' ? other.stage : other.platform,
          summary,
          keyExcerpt: latestTurn?.text,
          sentiment:
            latestTurn && latestTurn.sentimentScore > 0.15
              ? 'positive'
              : latestTurn && latestTurn.sentimentScore < -0.15
              ? 'cautious'
              : 'neutral',
        });
      }

      // Merge stored historical touchpoints with live cross-meeting DB records (deduplicated)
      const combinedHistory: StakeholderInteraction[] = [...meetingHistory];
      for (const hist of profile?.priorInteractions || []) {
        if (hist.meetingId && combinedHistory.some((h) => h.meetingId === hist.meetingId)) {
          continue;
        }
        combinedHistory.push(hist);
      }

      combinedHistory.sort((a, b) => b.date.localeCompare(a.date));

      return {
        id: profile?.id || `stk-inline-${meeting.id}-${idx}`,
        name: resolvedName,
        role: resolvedRole,
        accountName: profile?.accountName || meeting.accountName,
        buyingRole: profile?.buyingRole || this.inferBuyingRole(resolvedRole),
        email: profile?.email,
        focusAreas: profile?.focusAreas || [],
        totalInteractions: combinedHistory.length + (currentMeetingTurns > 0 ? 1 : 0),
        currentMeetingTurns,
        previousInteractions: combinedHistory,
      };
    });
  }

  logAudit(params: {
    organisationId: string;
    actorName: string;
    actorRole: UserProfile['role'];
    action: string;
    resource: string;
  }): void {
    this.state.auditEvents.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      organisationId: params.organisationId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      action: params.action,
      resource: params.resource,
      createdAt: new Date().toISOString(),
    });
    this.state.auditEvents = this.state.auditEvents.slice(0, 100);
  }

  computeEvaluationMetrics(organisationId: string): EvaluationMetrics {
    const orgMeetings = this.state.meetings.filter((m) => m.organisationId === organisationId);
    const totalTranscriptTurns = orgMeetings.reduce((sum, m) => sum + m.transcript.length, 0);
    const totalSignalsDetected = orgMeetings.reduce((sum, m) => sum + (m.signals?.length || 0), 0);
    const allInsights = orgMeetings.flatMap((m) => m.insights);
    const recommendationsShown = allInsights.length;
    const helpfulCount = allInsights.filter((i) => i.feedback?.rating === 'helpful').length;
    const usedCount = allInsights.filter((i) => i.feedback?.rating === 'used' || i.applied).length;
    const incorrectCount = allInsights.filter((i) => i.feedback?.rating === 'incorrect').length;
    const notRelevantCount = allInsights.filter((i) => i.feedback?.rating === 'not_relevant').length;
    const alreadyHandledCount = allInsights.filter(
      (i) => i.feedback?.rating === 'already_handled',
    ).length;
    const dismissedCount = allInsights.filter((i) => i.dismissed).length;
    const duplicateSuppressedCount = orgMeetings.reduce(
      (sum, m) => sum + (m.suppressedDuplicatesCount || 0),
      0,
    );
    const abstentionCount = allInsights.filter((i) => i.abstained).length;

    const ratedCount =
      helpfulCount + usedCount + incorrectCount + notRelevantCount + alreadyHandledCount;
    const helpfulRatePct =
      ratedCount > 0 ? Math.round(((helpfulCount + usedCount) / ratedCount) * 100) : 0;

    const nonAbstained = allInsights.filter((i) => !i.abstained);
    const withSources = nonAbstained.filter((i) => i.supportingSources.length > 0).length;
    const sourceCoveragePct =
      nonAbstained.length > 0 ? Math.round((withSources / nonAbstained.length) * 100) : 100;

    const latencies = allInsights
      .map((i) => i.latencyMs)
      .filter((v): v is number => typeof v === 'number' && v > 0)
      .sort((a, b) => a - b);
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;
    const p95LatencyMs =
      latencies.length > 0
        ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
        : 0;

    return {
      totalTranscriptTurns,
      totalSignalsDetected,
      recommendationsShown,
      helpfulCount,
      usedCount,
      incorrectCount,
      notRelevantCount,
      alreadyHandledCount,
      dismissedCount,
      duplicateSuppressedCount,
      helpfulRatePct,
      sourceCoveragePct,
      abstentionCount,
      avgLatencyMs,
      p95LatencyMs,
    };
  }

  getDashboardData(organisationId: string): DashboardData {
    const org = this.getOrganisation(organisationId);
    const orgMeetings = this.state.meetings.filter((m) => m.organisationId === org.id);
    const orgDocs = this.state.knowledgeDocs.filter(
      (d) => d.organisationId === org.id && d.status === 'indexed',
    );
    const orgBattlecards = this.state.battlecards.filter((b) => b.organisationId === org.id);

    const activeMeetings = orgMeetings.filter((m) => m.status === 'active' || m.status === 'paused');
    const activePipelineValue = orgMeetings.reduce((sum, m) => sum + m.dealValue, 0);
    const allInsights = orgMeetings.flatMap((m) => m.insights);
    const competitorMentions = allInsights.filter(
      (i) => i.category === 'competitor' || Boolean(i.competitorName),
    ).length;
    const objectionsHandled = allInsights.filter((i) => i.category === 'objection').length;

    const competitorTelemetry = orgBattlecards.map((bc) => {
      const mentions = orgMeetings.filter(
        (m) =>
          m.primaryCompetitor.toLowerCase() === bc.competitorName.toLowerCase() ||
          m.insights.some(
            (i) => i.competitorName?.toLowerCase() === bc.competitorName.toLowerCase(),
          ),
      ).length;
      return {
        competitorName: bc.competitorName,
        mentions,
        winRatePct: bc.winRatePct,
        topObjection: bc.quickCounters[0]?.claim ?? 'Pricing & migration risk',
      };
    });

    return {
      organisation: org,
      kpis: {
        activePipelineValue,
        activeMeetingsCount: activeMeetings.length,
        competitorMentions7d: competitorMentions,
        objectionsHandledCount: objectionsHandled,
        indexedDocsCount: orgDocs.length,
      },
      evaluation: this.computeEvaluationMetrics(org.id),
      recentMeetings: orgMeetings,
      recentInsights: allInsights
        .filter((i) => !i.dismissed)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10),
      competitorTelemetry,
    };
  }

  async ensureChunkEmbeddings(options?: {
    forceReindex?: boolean;
    organisationId?: string;
  }): Promise<{
    totalTargeted: number;
    embeddedCount: number;
    embeddingProvider: 'huggingface_local';
    embeddingModel: string;
    embeddingDimension: number;
  }> {
    const embCfg = getEmbeddingConfig();
    if (this.indexingInFlight) {
      return {
        totalTargeted: 0,
        embeddedCount: 0,
        embeddingProvider: embCfg.provider,
        embeddingModel: embCfg.model,
        embeddingDimension: embCfg.expectedDimension,
      };
    }

    const candidates = this.state.knowledgeChunks.filter((c) => {
      if (options?.organisationId && c.organisationId !== options.organisationId) return false;
      if (options?.forceReindex) return true;
      return (
        !c.embedding ||
        c.embedding.length === 0 ||
        c.embeddingModel !== embCfg.model
      );
    });

    if (candidates.length === 0) {
      return {
        totalTargeted: 0,
        embeddedCount: 0,
        embeddingProvider: embCfg.provider,
        embeddingModel: embCfg.model,
        embeddingDimension: embCfg.expectedDimension,
      };
    }

    this.indexingInFlight = true;
    let embeddedCount = 0;
    try {
      const vectors = await salesAI.embedTexts(
        candidates.map(
          (c) => `${c.docTitle}${c.headingPath ? ` — ${c.headingPath}` : ''}\n${c.content}`,
        ),
        'document',
      );
      if (vectors.length > 0) {
        candidates.forEach((chunk, idx) => {
          if (vectors[idx] && vectors[idx].length > 0) {
            chunk.embedding = vectors[idx];
            chunk.embeddingModel = embCfg.model;
            chunk.embeddingDimension = vectors[idx].length;
            embeddedCount += 1;
          }
        });
      }
      for (const doc of this.state.knowledgeDocs) {
        if (options?.organisationId && doc.organisationId !== options.organisationId) continue;
        const docChunks = this.state.knowledgeChunks.filter((c) => c.docId === doc.id);
        const allValid =
          docChunks.length > 0 &&
          docChunks.every(
            (c) => c.embedding && c.embedding.length > 0 && c.embeddingModel === embCfg.model,
          );
        doc.indexedWithEmbeddings = allValid;
        doc.embeddingModel = embCfg.model;
        doc.embeddingDimension =
          docChunks.find((c) => c.embeddingDimension)?.embeddingDimension ||
          embCfg.expectedDimension;
        doc.ingestionStage = 'indexed';
      }
      this.save();
    } catch {
      // Non-fatal; lexical fallback still supports retrieval
    } finally {
      this.indexingInFlight = false;
    }

    return {
      totalTargeted: candidates.length,
      embeddedCount,
      embeddingProvider: embCfg.provider,
      embeddingModel: embCfg.model,
      embeddingDimension: embCfg.expectedDimension,
    };
  }

  async searchKnowledge(
    organisationId: string,
    query: string,
    topK = 5,
    options?: { includeDrafts?: boolean },
  ): Promise<RagSearchResult[]> {
    const embCfg = getEmbeddingConfig();
    const todayIso = new Date().toISOString().slice(0, 10);
    const includeDrafts = Boolean(options?.includeDrafts);

    // 1. Metadata filter BEFORE retrieval (§5.8): tenant + indexed + approvalStatus + validUntil
    const docMap = new Map<string, KnowledgeDoc>();
    for (const d of this.state.knowledgeDocs) {
      if (d.organisationId !== organisationId || d.status !== 'indexed') continue;
      const approval = d.approvalStatus || 'approved';
      if (approval === 'rejected' || approval === 'expired') continue;
      if (!includeDrafts && approval !== 'approved') continue;
      if (d.validUntil && d.validUntil < todayIso && !includeDrafts) continue;
      docMap.set(d.id, d);
    }

    const scopedChunks = this.state.knowledgeChunks.filter(
      (c) => c.organisationId === organisationId && docMap.has(c.docId),
    );
    if (scopedChunks.length === 0) return [];

    // 2. Embed query locally via Hugging Face only if compatible vectors for the active model exist (§2.3 / §5.7 guard)
    let queryEmbedding: number[] | null = null;
    const anyCompatibleEmbedded = scopedChunks.some(
      (c) => c.embedding && c.embedding.length > 0 && c.embeddingModel === embCfg.model,
    );
    if (anyCompatibleEmbedded) {
      try {
        const res = await Promise.race([
          salesAI.embedTexts([query], 'query'),
          new Promise<number[][]>((_, reject) =>
            setTimeout(() => reject(new Error('Embed timeout')), 15000),
          ),
        ]);
        if (res[0] && res[0].length > 0) {
          queryEmbedding = res[0];
        }
      } catch {
        queryEmbedding = null;
      }
    }

    // 3. First-pass hybrid recall (top 12)
    const recalled = scopedChunks
      .map((chunk) => {
        const doc = docMap.get(chunk.docId)!;
        const lex = lexicalScore(
          query,
          `${chunk.docTitle} ${chunk.sectionTitle || ''} ${chunk.content}`,
          chunk.headingPath || chunk.sectionTitle || '',
        );
        const compatibleVec =
          Boolean(queryEmbedding) &&
          Boolean(chunk.embedding) &&
          chunk.embeddingModel === embCfg.model &&
          chunk.embedding!.length === queryEmbedding!.length;
        const vec = compatibleVec ? cosineSimilarity(queryEmbedding!, chunk.embedding!) : 0;
        const recallScore = compatibleVec ? vec * 0.72 + lex * 0.28 : lex;
        return { chunk, doc, lex, vec, compatibleVec, recallScore };
      })
      .sort((a, b) => b.recallScore - a.recallScore)
      .slice(0, 12);

    // 4. Rerank top 12 -> topK with exact-entity boost, atomic fact boost, and per-doc diversity
    const queryLower = query.toLowerCase();
    const reranked = recalled
      .map((item) => {
        let boost = 0;
        if (item.chunk.isAtomicFact) boost += 0.04;
        if (item.doc.approvalStatus === 'approved') boost += 0.03;
        if (
          item.chunk.headingPath &&
          queryLower.split(/\s+/).some((w) => w.length > 3 && item.chunk.headingPath!.toLowerCase().includes(w))
        ) {
          boost += 0.06;
        }
        const finalScore = Math.min(1, item.recallScore + boost);
        return { ...item, finalScore };
      })
      .sort((a, b) => b.finalScore - a.finalScore);

    // Deduplicate excessive chunks from same document (max 2 per doc unless corpus is tiny)
    const perDocCounts = new Map<string, number>();
    const finalResults: RagSearchResult[] = [];
    for (const item of reranked) {
      if (finalResults.length >= topK) break;
      const count = perDocCounts.get(item.doc.id) || 0;
      if (count >= 2 && reranked.length > topK) continue;
      perDocCounts.set(item.doc.id, count + 1);
      finalResults.push({
        chunkId: item.chunk.id,
        docId: item.chunk.docId,
        docTitle: item.chunk.docTitle,
        category: item.chunk.category,
        sectionTitle: item.chunk.sectionTitle,
        headingPath: item.chunk.headingPath,
        pageNumber: item.chunk.pageNumber,
        tokenCount: item.chunk.tokenCount,
        approvalStatus: item.doc.approvalStatus || 'approved',
        version: item.doc.version,
        embeddingModel: item.compatibleVec ? item.chunk.embeddingModel : undefined,
        content: item.chunk.content,
        score: Number(item.finalScore.toFixed(4)),
      });
    }

    return finalResults;
  }
}

export const store = new SalesStore();
