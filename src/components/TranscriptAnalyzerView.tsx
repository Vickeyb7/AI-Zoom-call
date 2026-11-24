import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Download,
  FileText,
  FileUp,
  Lightbulb,
  Loader2,
  MessageSquareQuote,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import { SentimentTimelineChart } from './SentimentTimelineChart';
import { exportMeetingReportPdf } from '../lib/exportMeetingReportPdf';
import type {
  Battlecard,
  DealStage,
  DealStrategyIdea,
  MeetingSession,
  TranscriptAnalysisResult,
} from '../types/sales';

interface TranscriptAnalyzerViewProps {
  apiHeaders: Record<string, string>;
  battlecards: Battlecard[];
  onCopyText: (text: string, label?: string) => void;
  onRefresh: () => Promise<void>;
  onOpenMeetingsArchive: () => void;
}

const DEAL_STAGES: DealStage[] = [
  'Discovery',
  'Technical Validation',
  'Security Review',
  'Commercial Negotiation',
  'Executive Alignment',
];

const STRATEGY_CATEGORIES: ('All' | DealStrategyIdea['category'])[] = [
  'All',
  'Competitive',
  'Pricing & ROI',
  'Stakeholder Alignment',
  'Technical De-Risk',
  'Closing Motion',
];

const ALLOWED_EXTENSIONS = ['.txt', '.vtt', '.srt', '.md', '.docx', '.pdf'];

const SAMPLE_TRANSCRIPT = `[00:01:12] Maya Patel (Account Executive): Thanks everyone for joining. Before we dive into the rollout architecture, I want to make sure we cover the Q3 timeline and security checklist Marcus sent over.
[00:02:05] Elena Rostova (VP Engineering, Vertex Robotics): Appreciate it, Maya. To be candid, we liked the live sandbox last week, but our CFO is pushing back hard on the $240k annual list price. ApexCloud came in 22% lower on a two-year quote.
[00:03:18] Marcus Vance (CISO, Vertex Robotics): Price aside, my bigger blocker is data residency and zero-retention guarantees. If call transcripts sit on third-party servers for 30 days, legal will stall this past Q3.
[00:04:40] Maya Patel (Account Executive): Both fair points. On security, we enforce zero-day transcript retention by default so raw audio and transcripts aren't retained after post-call synthesis, and our SOC 2 Type II report covers EU and US residency.
[00:05:52] Marcus Vance (CISO, Vertex Robotics): That actually addresses my main redline. If you can send the SOC 2 bridge letter and architecture diagram by Thursday, security sign-off should be straightforward.
[00:07:10] Elena Rostova (VP Engineering, Vertex Robotics): Good to hear. On the commercial side, ApexCloud looked cheaper up front, though their engineering team admitted real-time CRM sync requires a separate paid connector and six weeks of professional services.
[00:08:25] Maya Patel (Account Executive): Exactly — most teams migrating from ApexCloud save roughly 35% in year-one total cost once you include implementation and connector fees. If we phase the rollout across 40 seats in Q3 and expand to 120 in Q4, would that unlock CFO approval?
[00:09:44] Elena Rostova (VP Engineering, Vertex Robotics): A phased ramp helps a lot. Our CFO, David Chen, needs to see a 6-month payback model before our Tuesday executive steering committee. If you can put together that ROI brief and join the first 15 minutes with David next Tuesday, I am ready to champion this for a Q3 signature.`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function toneTextClass(tone: 'Constructive' | 'Neutral' | 'Cautious' | 'Friction'): string {
  if (tone === 'Constructive') return 'text-emerald-700';
  if (tone === 'Friction') return 'text-rose-700';
  if (tone === 'Cautious') return 'text-amber-700';
  return 'text-slate-600';
}

function priorityAccentClass(priority: DealStrategyIdea['priority']): string {
  if (priority === 'High') return 'text-rose-700';
  if (priority === 'Medium') return 'text-amber-700';
  return 'text-slate-500';
}

function buildReportMeeting(result: TranscriptAnalysisResult): MeetingSession {
  return {
    id: result.savedMeetingId || result.id,
    organisationId: 'analyzed',
    title: result.meetingTitle,
    accountName: result.accountName,
    platform: 'Simulator',
    dealValue: result.dealValue,
    stage: result.stage,
    status: 'completed',
    captureConsentConfirmed: true,
    aeName: 'Account Team',
    prospectStakeholders:
      result.detectedStakeholders.length > 0
        ? result.detectedStakeholders
        : ['Customer Stakeholder'],
    primaryCompetitor: result.detectedCompetitors[0] || 'None identified',
    startedAt: result.analyzedAt,
    endedAt: result.analyzedAt,
    durationMinutes: Math.max(15, Math.min(90, Math.round(result.wordCount / 130))),
    aeTalkRatio: 44,
    prospectTalkRatio: 56,
    sentimentTrend: result.sentimentSegments.map((s) => s.score),
    sentimentSegments: result.sentimentSegments,
    qualification: [],
    transcript: result.sentimentDrivers.map((d, idx) => ({
      id: `drv-${idx}`,
      speaker: 'Prospect',
      speakerName: d.speaker,
      text: d.excerpt,
      timestamp: `00:${String(Math.min(59, idx * 4 + 2)).padStart(2, '0')}`,
      detectedTags: [d.topic],
      sentimentScore:
        d.sentiment === 'Constructive'
          ? 0.7
          : d.sentiment === 'Friction'
          ? -0.7
          : d.sentiment === 'Cautious'
          ? -0.2
          : 0.1,
    })),
    insights: [],
    signals: [],
    scratchpad: result.dealStrategyIdeas.map((idea) => ({
      id: idea.id,
      text: `[${idea.priority} · ${idea.category}] ${idea.title} — ${idea.actionPlan}`,
      sourceTitle: 'AI Deal Strategy',
      createdAt: result.analyzedAt.slice(0, 10),
    })),
    suppressedDuplicatesCount: 0,
    summaryStatus: 'ready',
    executiveSummary: {
      keyDecisions: result.keyDecisions,
      facts: [result.overallSentiment.summary, ...result.buyingSignals],
      interpretations: result.dealStrategyIdeas.map(
        (idea) => `${idea.title}: ${idea.rationale} (${idea.expectedImpact})`,
      ),
      nextSteps: result.nextSteps,
      followUpEmail: '',
      autoGenerated: true,
      chunkCount: result.sentimentSegments.length,
      generatedAt: result.analyzedAt,
    },
  };
}

export const TranscriptAnalyzerView: React.FC<TranscriptAnalyzerViewProps> = ({
  apiHeaders,
  battlecards,
  onCopyText,
  onRefresh,
  onOpenMeetingsArchive,
}) => {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [transcriptText, setTranscriptText] = React.useState('');
  const [accountName, setAccountName] = React.useState('');
  const [meetingTitle, setMeetingTitle] = React.useState('');
  const [stage, setStage] = React.useState<DealStage>('Commercial Negotiation');
  const [dealValue, setDealValue] = React.useState('240000');
  const [primaryCompetitor, setPrimaryCompetitor] = React.useState('');
  const [saveToArchive, setSaveToArchive] = React.useState(true);

  const [dragActive, setDragActive] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<TranscriptAnalysisResult | null>(null);

  const [activeResultTab, setActiveResultTab] = React.useState<
    'strategy' | 'sentiment' | 'signals'
  >('strategy');
  const [strategyFilter, setStrategyFilter] = React.useState<
    'All' | DealStrategyIdea['category']
  >('All');
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [exportedPdf, setExportedPdf] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFilePicked = (file: File | null) => {
    setError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const lower = file.name.toLowerCase();
    const valid = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    if (!valid) {
      setError(
        `Unsupported file format. Upload ${ALLOWED_EXTENSIONS.join(', ')} or paste transcript text below.`,
      );
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('File exceeds the 15 MB limit. Trim or paste the relevant transcript excerpt.');
      return;
    }
    setSelectedFile(file);
    if (!accountName.trim()) {
      const cleaned = file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      if (cleaned) setAccountName(cleaned);
    }
  };

  const handleLoadSample = () => {
    setError(null);
    setSelectedFile(null);
    setAccountName('Vertex Robotics');
    setMeetingTitle('Vertex Robotics — Q3 Commercial & Security Alignment');
    setStage('Commercial Negotiation');
    setDealValue('240000');
    setPrimaryCompetitor('ApexCloud');
    setTranscriptText(SAMPLE_TRANSCRIPT);
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && transcriptText.trim().length < 40) {
      setError('Upload a transcript file or paste at least 40 characters of meeting dialogue.');
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append('file', selectedFile);
      }
      if (transcriptText.trim()) {
        formData.append('transcriptText', transcriptText.trim());
      }
      if (accountName.trim()) formData.append('accountName', accountName.trim());
      if (meetingTitle.trim()) formData.append('meetingTitle', meetingTitle.trim());
      formData.append('stage', stage);
      formData.append('dealValue', dealValue || '180000');
      if (primaryCompetitor.trim()) {
        formData.append('primaryCompetitor', primaryCompetitor.trim());
      }
      formData.append('saveToArchive', String(saveToArchive));

      const res = await fetch('/api/meetings/analyze-transcript', {
        method: 'POST',
        headers: apiHeaders,
        body: formData,
      });

      const payload = (await res.json()) as TranscriptAnalysisResult & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to analyze transcript');
      }

      setResult(payload);
      setActiveResultTab('strategy');
      setStrategyFilter('All');
      if (payload.savedMeetingId) {
        void onRefresh();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to analyze transcript right now.',
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCopyTalkTrack = (idea: DealStrategyIdea) => {
    onCopyText(idea.suggestedTalkTrack, `Copied talk track: ${idea.title}`);
    setCopiedId(idea.id);
    window.setTimeout(() => setCopiedId((curr) => (curr === idea.id ? null : curr)), 1800);
  };

  const handleExportPdf = () => {
    if (!result) return;
    exportMeetingReportPdf(buildReportMeeting(result));
    setExportedPdf(true);
    window.setTimeout(() => setExportedPdf(false), 2000);
  };

  const filteredStrategies = React.useMemo(() => {
    if (!result) return [];
    if (strategyFilter === 'All') return result.dealStrategyIdeas;
    return result.dealStrategyIdeas.filter((idea) => idea.category === strategyFilter);
  }, [result, strategyFilter]);

  const syntheticChartMeeting = React.useMemo(
    () => (result ? buildReportMeeting(result) : null),
    [result],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 4 Columns: Transcript Upload & Deal Context Form */}
      <form
        onSubmit={(e) => void handleAnalyze(e)}
        className="lg:col-span-4 eki-card rounded-lg p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-slate-900">
              Upload Meeting Transcript
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Generate grounded deal strategy plays and customer sentiment insights from any recorded call.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLoadSample}
            className="text-xs font-medium text-[#4F46E5] hover:text-[#3525CD] whitespace-nowrap shrink-0"
          >
            Load Sample
          </button>
        </div>

        {/* File Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const dropped = e.dataTransfer.files?.[0] || null;
            handleFilePicked(dropped);
          }}
          className={`rounded-lg border border-dashed p-4 transition-colors ${
            dragActive
              ? 'border-[#4F46E5] bg-[#EEF2FF]/60'
              : 'border-slate-300 bg-[#F8FAFC] hover:border-slate-400'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.join(',')}
            onChange={(e) => handleFilePicked(e.target.files?.[0] || null)}
            className="hidden"
          />

          {selectedFile ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-md bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {selectedFile.name}
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-slate-500">
                    {formatBytes(selectedFile.size)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                aria-label="Remove uploaded file"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-1.5 py-2 text-center focus-visible:outline-none"
            >
              <Upload className="w-5 h-5 text-[#4F46E5]" />
              <div className="text-xs font-medium text-slate-800">
                Drop transcript file or click to browse
              </div>
              <div className="text-[11px] text-slate-500">
                Zoom/Teams VTT, SRT, TXT, MD, DOCX, or PDF · Max 15 MB
              </div>
            </button>
          )}
        </div>

        {/* Or Paste Transcript */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="paste-transcript-input"
              className="text-xs font-medium text-slate-700"
            >
              Or Paste Transcript Text
            </label>
            {transcriptText.trim().length > 0 && (
              <span className="font-mono text-[11px] tabular-nums text-slate-400">
                {transcriptText.trim().split(/\s+/).length} words
              </span>
            )}
          </div>
          <textarea
            id="paste-transcript-input"
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            rows={6}
            placeholder="[00:01:12] Prospect (CFO): We need to see stronger ROI before committing..."
            className="eki-input w-full rounded-md px-3 py-2 text-xs leading-relaxed resize-y font-mono"
          />
        </div>

        {/* Deal Context Metadata */}
        <div className="pt-2 border-t border-slate-100 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Deal Context (Optional)
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Account Name
              </label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g., Vertex Robotics"
                className="eki-input w-full rounded-md px-2.5 py-1.5 text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Deal Stage
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as DealStage)}
                className="eki-input w-full rounded-md px-2.5 py-1.5 text-xs bg-white"
              >
                {DEAL_STAGES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Deal Value (USD)
              </label>
              <input
                type="number"
                min={0}
                step={5000}
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value)}
                className="eki-input w-full rounded-md px-2.5 py-1.5 text-xs font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Primary Competitor
              </label>
              <input
                type="text"
                list="competitor-battlecards-list"
                value={primaryCompetitor}
                onChange={(e) => setPrimaryCompetitor(e.target.value)}
                placeholder="Auto-detect or specify"
                className="eki-input w-full rounded-md px-2.5 py-1.5 text-xs"
              />
              <datalist id="competitor-battlecards-list">
                {battlecards.map((bc) => (
                  <option key={bc.id} value={bc.competitorName} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Meeting Title
            </label>
            <input
              type="text"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              placeholder="Optional custom report title"
              className="eki-input w-full rounded-md px-2.5 py-1.5 text-xs"
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={saveToArchive}
              onChange={(e) => setSaveToArchive(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-[#4F46E5] focus:ring-[#4F46E5]"
            />
            <span>
              Save analyzed strategy summary &amp; sentiment timeline to Meetings Archive
            </span>
          </label>
        </div>

        {error && (
          <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] px-3 py-2 text-xs text-[#9F1239] flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={analyzing || (!selectedFile && transcriptText.trim().length === 0)}
          className="eki-btn-primary w-full py-2.5 px-4 rounded-md text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
        >
          {analyzing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing Deal Strategy &amp; Sentiment...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Analyze Deal Strategy &amp; Sentiment
            </>
          )}
        </button>
      </form>

      {/* Right 8 Columns: Analysis Results */}
      <div className="lg:col-span-8 space-y-5">
        {!result && !analyzing && (
          <div className="eki-card rounded-lg p-8 space-y-6">
            <div className="max-w-xl space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#4F46E5]">
                <FileUp className="w-4 h-4" />
                Post-Call Deal Intelligence
              </div>
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Turn any call transcript into concrete deal plays and buyer sentiment diagnostics
              </h3>
              <p className="text-[13px] text-slate-600 leading-relaxed">
                Upload a Zoom, Teams, or Meet transcript file—or paste dialogue directly—to cross-reference your workspace Knowledge Base and Competitive Battlecards automatically.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Lightbulb className="w-4 h-4 text-[#4F46E5]" />
                  AI Deal Strategy Plays
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Prioritized Competitive, Pricing &amp; ROI, Technical De-Risk, and Closing plays complete with copyable talk tracks.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  Customer Sentiment Flow
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Chronological sentiment trajectory from opening to close plus exact verbatim moments driving enthusiasm or friction.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Compass className="w-4 h-4 text-slate-700" />
                  Grounded &amp; Exportable
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Anchored in your workspace playbooks and exportable as an executive PDF report or saved straight to Meetings Archive.
                </p>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleLoadSample}
                className="eki-btn-secondary px-3.5 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                Load Sample Enterprise Transcript
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {analyzing && (
          <div className="eki-card rounded-lg p-10 flex flex-col items-center justify-center text-center space-y-3">
            <Loader2 className="w-6 h-6 text-[#4F46E5] animate-spin" />
            <div className="space-y-1">
              <div className="font-display text-sm font-semibold text-slate-900">
                Synthesizing deal strategy and customer sentiment...
              </div>
              <p className="text-xs text-slate-500 max-w-md">
                Parsing transcript segments, retrieving relevant Knowledge Base evidence and Battlecards, and scoring buyer sentiment shifts.
              </p>
            </div>
          </div>
        )}

        {result && !analyzing && (
          <>
            {/* Executive Header & Sentiment Telemetry */}
            <div className="eki-card rounded-lg p-5 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                    <span>{result.stage}</span>
                    <span aria-hidden="true">·</span>
                    <span>${result.dealValue.toLocaleString()}</span>
                    <span aria-hidden="true">·</span>
                    <span>{result.wordCount.toLocaleString()} words</span>
                    <span aria-hidden="true">·</span>
                    <span>{result.turnCount} turns</span>
                    {result.fileName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[180px]">{result.fileName}</span>
                      </>
                    )}
                  </div>
                  <h2 className="font-display text-lg font-semibold text-slate-900 leading-snug">
                    {result.accountName}
                  </h2>
                  <p className="text-xs text-slate-500">{result.meetingTitle}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {exportedPdf ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        PDF Exported
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5 text-slate-600" />
                        Export PDF Report
                      </>
                    )}
                  </button>
                  {result.savedMeetingId && (
                    <button
                      type="button"
                      onClick={onOpenMeetingsArchive}
                      className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      View in Archive
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  )}
                </div>
              </div>

              {/* Unboxed Metadata Strip: Stakeholders & Competitors */}
              {(result.detectedStakeholders.length > 0 ||
                result.detectedCompetitors.length > 0) && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-600 pt-3 border-t border-slate-100">
                  {result.detectedStakeholders.length > 0 && (
                    <div>
                      <span className="font-medium text-slate-800">Stakeholders: </span>
                      {result.detectedStakeholders.join(' · ')}
                    </div>
                  )}
                  {result.detectedCompetitors.length > 0 && (
                    <div>
                      <span className="font-medium text-slate-800">Competitors: </span>
                      <span className="text-amber-800 font-medium">
                        {result.detectedCompetitors.join(' · ')}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Customer Sentiment KPI Row */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-3 border-t border-slate-100 items-center">
                <div className="md:col-span-3 flex items-baseline gap-2.5">
                  <span className="font-mono text-3xl font-bold tabular-nums text-slate-900">
                    {result.overallSentiment.score}
                  </span>
                  <div className="space-y-0.5">
                    <div
                      className={`text-xs font-semibold ${toneTextClass(
                        result.overallSentiment.tone,
                      )}`}
                    >
                      {result.overallSentiment.tone}
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-slate-500 inline-flex items-center gap-1">
                      {result.overallSentiment.shift >= 0 ? (
                        <TrendingUp className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-rose-600" />
                      )}
                      {result.overallSentiment.shift >= 0 ? '+' : ''}
                      {result.overallSentiment.shift} pts shift
                    </div>
                  </div>
                </div>
                <p className="md:col-span-9 text-[13px] text-slate-700 leading-relaxed">
                  {result.overallSentiment.summary}
                </p>
              </div>

              {/* Embedded Recharts Customer Sentiment Timeline */}
              {syntheticChartMeeting && (
                <SentimentTimelineChart meeting={syntheticChartMeeting} />
              )}
            </div>

            {/* Segmented View Switcher */}
            <div className="eki-card rounded-lg overflow-hidden">
              <div className="px-4 pt-3 pb-3 border-b border-slate-200 bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setActiveResultTab('strategy')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      activeResultTab === 'strategy'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Deal Strategy Ideas ({result.dealStrategyIdeas.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveResultTab('sentiment')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      activeResultTab === 'sentiment'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Customer Sentiment Drivers ({result.sentimentDrivers.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveResultTab('signals')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      activeResultTab === 'signals'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Signals, Decisions &amp; Sources
                  </button>
                </div>

                {activeResultTab === 'strategy' && result.dealStrategyIdeas.length > 1 && (
                  <select
                    aria-label="Filter deal strategy category"
                    value={strategyFilter}
                    onChange={(e) =>
                      setStrategyFilter(e.target.value as 'All' | DealStrategyIdea['category'])
                    }
                    className="eki-input rounded-md px-2.5 py-1 text-xs bg-white"
                  >
                    {STRATEGY_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat === 'All' ? 'All Categories' : cat}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Tab 1: AI Deal Strategy Ideas */}
              {activeResultTab === 'strategy' && (
                <div className="divide-y divide-slate-100">
                  {filteredStrategies.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      No strategy plays in the selected category.
                    </div>
                  ) : (
                    filteredStrategies.map((idea) => (
                      <div key={idea.id} className="p-5 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                              <span
                                className={`font-semibold uppercase tracking-wider ${priorityAccentClass(
                                  idea.priority,
                                )}`}
                              >
                                {idea.priority} Priority
                              </span>
                              <span className="text-slate-300" aria-hidden="true">
                                ·
                              </span>
                              <span className="font-medium text-[#4338CA]">{idea.category}</span>
                            </div>
                            <h3 className="font-display text-[15px] font-semibold text-slate-900">
                              {idea.title}
                            </h3>
                          </div>
                        </div>

                        <p className="text-[13px] text-slate-700 leading-relaxed">
                          {idea.rationale}
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-3 space-y-1">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Action Plan
                            </div>
                            <p className="text-slate-800 leading-relaxed">{idea.actionPlan}</p>
                          </div>
                          <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-3 space-y-1">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Expected Deal Impact
                            </div>
                            <p className="text-slate-800 leading-relaxed">{idea.expectedImpact}</p>
                          </div>
                        </div>

                        {idea.suggestedTalkTrack && (
                          <div className="rounded-md bg-[#EEF2FF]/45 border border-[#E0E7FF] p-3.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4338CA]">
                                Suggested Talk Track
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyTalkTrack(idea)}
                                className="text-xs font-medium text-[#4F46E5] hover:text-[#3525CD] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                {copiedId === idea.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    Copy Talk Track
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="text-xs text-slate-800 leading-relaxed">
                              &ldquo;{idea.suggestedTalkTrack}&rdquo;
                            </p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 2: Customer Sentiment Drivers */}
              {activeResultTab === 'sentiment' && (
                <div className="divide-y divide-slate-100">
                  {result.sentimentDrivers.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      No specific customer sentiment drivers extracted from this transcript.
                    </div>
                  ) : (
                    result.sentimentDrivers.map((driver) => (
                      <div key={driver.id} className="p-5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span
                              className={`font-semibold ${toneTextClass(driver.sentiment)}`}
                            >
                              {driver.sentiment}
                            </span>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-semibold text-slate-900">{driver.speaker}</span>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-slate-600">{driver.topic}</span>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 rounded-md bg-[#F8FAFC] border border-slate-200 px-3 py-2.5">
                          <MessageSquareQuote className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-slate-700 italic leading-relaxed">
                            &ldquo;{driver.excerpt}&rdquo;
                          </p>
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed">
                          <span className="font-medium text-slate-800">Deal Implication: </span>
                          {driver.signalImpact}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 3: Buying Signals, Risks, Decisions, Next Steps & Grounded Sources */}
              {activeResultTab === 'signals' && (
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-4 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                        Buying Signals
                      </div>
                      {result.buyingSignals.length === 0 ? (
                        <p className="text-xs text-slate-500">No explicit buying signals noted.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-800">
                          {result.buyingSignals.map((sig, i) => (
                            <li key={i} className="flex items-start gap-2 leading-relaxed">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span>{sig}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-4 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">
                        Deal Risk Factors
                      </div>
                      {result.riskFactors.length === 0 ? (
                        <p className="text-xs text-slate-500">No major risk factors flagged.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-800">
                          {result.riskFactors.map((risk, i) => (
                            <li key={i} className="flex items-start gap-2 leading-relaxed">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                              <span>{risk}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-md bg-white border border-slate-200 p-4 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4338CA]">
                        Key Meeting Decisions
                      </div>
                      {result.keyDecisions.length === 0 ? (
                        <p className="text-xs text-slate-500">No binding decisions captured.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-800">
                          {result.keyDecisions.map((dec, i) => (
                            <li key={i} className="flex items-start gap-2 leading-relaxed">
                              <span className="text-[#4F46E5] font-bold">•</span>
                              <span>{dec}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-md bg-white border border-slate-200 p-4 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                        Recommended Next Steps
                      </div>
                      {result.nextSteps.length === 0 ? (
                        <p className="text-xs text-slate-500">No next steps identified.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-800">
                          {result.nextSteps.map((step, i) => (
                            <li key={i} className="flex items-start gap-2 leading-relaxed">
                              <span className="font-mono text-[#4F46E5] font-semibold">
                                {i + 1}.
                              </span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {result.groundedSources.length > 0 && (
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <BookOpen className="w-3.5 h-3.5 text-[#4F46E5]" />
                        Workspace Knowledge Grounding
                      </div>
                      <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-[#F8FAFC]">
                        {result.groundedSources.map((src) => (
                          <div
                            key={src.docId}
                            className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="font-medium text-slate-800 truncate">
                              {src.title}
                            </span>
                            <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                              {src.category}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
