import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Database,
  PauseCircle,
  Play,
  Radio,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { DashboardData, InsightCategory, MeetingSession } from '../types/sales';

interface DashboardViewProps {
  data: DashboardData | null;
  loading: boolean;
  onOpenCopilot: (meetingId: string) => void;
  onStartNewMeeting: () => void;
  onNavigateBattlecards: () => void;
  onNavigateKnowledge: () => void;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val);
}

function Sparkline({ values }: { values: number[] }) {
  const safe = values.length >= 2 ? values : [50, 55];
  const max = Math.max(...safe, 100);
  const min = Math.min(...safe, 0);
  const range = Math.max(1, max - min);
  const width = 76;
  const height = 22;
  const points = safe
    .map((v, idx) => {
      const x = (idx / (safe.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const latest = safe[safe.length - 1];
  const stroke = latest >= 65 ? '#10B981' : latest >= 45 ? '#F59E0B' : '#F43F5E';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function insightBadge(category: InsightCategory): {
  label: string;
  bg: string;
  text: string;
  border: string;
} {
  switch (category) {
    case 'competitor':
      return {
        label: 'Competitor Mention',
        bg: 'bg-[#FFFBEB]',
        text: 'text-[#92400E]',
        border: 'border-[#FDE68A]',
      };
    case 'objection':
      return {
        label: 'Objection Detected',
        bg: 'bg-[#FFF1F2]',
        text: 'text-[#9F1239]',
        border: 'border-[#FECDD3]',
      };
    case 'buying_signal':
      return {
        label: 'Buying Signal',
        bg: 'bg-[#ECFDF5]',
        text: 'text-[#065F46]',
        border: 'border-[#A7F3D0]',
      };
    case 'risk':
      return {
        label: 'Deal Risk',
        bg: 'bg-[#FFF1F2]',
        text: 'text-[#9F1239]',
        border: 'border-[#FECDD3]',
      };
    case 'technical_answer':
      return {
        label: 'Technical Answer',
        bg: 'bg-[#EEF2FF]',
        text: 'text-[#4338CA]',
        border: 'border-[#E0E7FF]',
      };
    case 'discovery':
      return {
        label: 'Discovery Prompt',
        bg: 'bg-[#EFF6FF]',
        text: 'text-[#1E40AF]',
        border: 'border-[#BFDBFE]',
      };
    default:
      return {
        label: 'AI Recommendation',
        bg: 'bg-[#EEF2FF]',
        text: 'text-[#4338CA]',
        border: 'border-[#E0E7FF]',
      };
  }
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  loading,
  onOpenCopilot,
  onStartNewMeeting,
  onNavigateBattlecards,
  onNavigateKnowledge,
}) => {
  const [insightFilter, setInsightFilter] = React.useState<'all' | InsightCategory>('all');

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="eki-card rounded-lg p-5 h-28 animate-pulse bg-white" />
          ))}
        </div>
        <div className="eki-card rounded-lg h-72 animate-pulse bg-white" />
      </div>
    );
  }

  const filteredInsights =
    insightFilter === 'all'
      ? data.recentInsights
      : data.recentInsights.filter((i) => i.category === insightFilter);

  const liveMeeting = data.recentMeetings.find(
    (m) => m.status === 'active' || m.status === 'paused',
  );

  return (
    <div className="space-y-6">
      {/* Top 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="eki-card rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Pipeline Conversations</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-slate-900 tabular-nums">
              {formatCurrency(data.kpis.activePipelineValue)}
            </span>
            <span className="text-xs font-medium text-emerald-700 tabular-nums">
              {data.recentMeetings.length} calls
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {data.kpis.activeMeetingsCount} active capture session(s)
          </div>
        </div>

        <div className="eki-card rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Competitor Signals</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-slate-900 tabular-nums">
              {data.kpis.competitorMentions7d}
            </span>
            <span className="text-xs font-medium text-amber-700">Entity-resolved</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Canonical names &amp; aliases mapped
          </div>
        </div>

        <div className="eki-card rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Helpful / Used Rate</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-slate-900 tabular-nums">
              {data.evaluation.helpfulRatePct}%
            </span>
            <span className="text-xs font-medium text-[#4F46E5] tabular-nums">
              {data.evaluation.sourceCoveragePct}% cited
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            North Star pilot quality benchmark
          </div>
        </div>

        <div className="eki-card rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Approved Knowledge Base</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-slate-900 tabular-nums">
              {data.kpis.indexedDocsCount} docs
            </span>
            <button
              type="button"
              onClick={onNavigateKnowledge}
              className="text-xs font-medium text-[#4F46E5] hover:underline inline-flex items-center gap-1"
            >
              <Database className="w-3 h-3" /> Manage
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Scoped strictly to {data.organisation.name}
          </div>
        </div>
      </div>

      {/* Main 12-Col Split: Recent Meetings Table + Competitor Telemetry */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 eki-card rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
            <div>
              <h2 className="font-display text-[16px] font-semibold text-slate-900">
                Meeting Sessions &amp; Simulated Calls
              </h2>
              <p className="text-xs text-slate-500">
                Launch a simulated transcript or resume an active call in the Live Companion.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {liveMeeting && (
                <button
                  type="button"
                  onClick={() => onOpenCopilot(liveMeeting.id)}
                  className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Radio className="w-3.5 h-3.5 text-emerald-600" />
                  Open Active Call
                </button>
              )}
              <button
                type="button"
                onClick={onStartNewMeeting}
                className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                Start Simulated Meeting
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#F8FAFC] border-b border-slate-200 sticky top-0">
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Account &amp; Deal</th>
                  <th className="py-2.5 px-3">Capture State</th>
                  <th className="py-2.5 px-3">Competitor</th>
                  <th className="py-2.5 px-3">Talk Split</th>
                  <th className="py-2.5 px-3">Sentiment</th>
                  <th className="py-2.5 px-3 text-right">Qualification</th>
                  <th className="py-2.5 px-4 text-right">Companion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[13px]">
                {data.recentMeetings.map((mtg: MeetingSession, idx) => {
                  const qualCovered = mtg.qualification?.filter((q) => q.covered).length ?? 0;
                  const qualTotal = mtg.qualification?.length ?? 0;
                  return (
                    <tr
                      key={mtg.id}
                      className={`group transition-colors hover:bg-[#EEF2FF]/40 ${
                        idx % 2 === 1 ? 'bg-[#FAFAFA]' : 'bg-white'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{mtg.accountName}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 tabular-nums">
                          <span>{formatCurrency(mtg.dealValue)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{mtg.stage}</span>
                          <span aria-hidden="true">·</span>
                          <span>{mtg.platform}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {mtg.status === 'active' ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                            Active
                          </span>
                        ) : mtg.status === 'paused' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]">
                            <PauseCircle className="w-3 h-3" />
                            Paused
                          </span>
                        ) : mtg.status === 'created' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700">
                            Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600">
                            <CheckCircle2 className="w-3 h-3 text-slate-500" />
                            Stopped
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-[#FFFBEB] border border-[#FDE68A] px-2 py-0.5 rounded-md">
                          {mtg.primaryCompetitor}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                        {mtg.aeTalkRatio > 0 ? `${mtg.aeTalkRatio}% / ${mtg.prospectTalkRatio}%` : '—'}
                      </td>
                      <td className="py-3 px-3">
                        <Sparkline values={mtg.sentimentTrend} />
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-800">
                        {qualTotal > 0 ? `${qualCovered}/${qualTotal}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenCopilot(mtg.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-[#4F46E5] bg-[#EEF2FF] hover:bg-[#4F46E5] hover:text-white border border-[#E0E7FF] transition-colors"
                        >
                          <Play className="w-3 h-3" />
                          {mtg.status === 'active' ? 'Join' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 4 Columns: Competitor Radar + Pilot Evaluation Telemetry */}
        <div className="xl:col-span-4 space-y-6">
          <div className="eki-card rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-[16px] font-semibold text-slate-900">
                  Competitor Radar
                </h2>
                <p className="text-xs text-slate-500">Approved battlecard win telemetry</p>
              </div>
              <button
                type="button"
                onClick={onNavigateBattlecards}
                className="text-xs font-medium text-[#4F46E5] hover:text-[#3525CD] inline-flex items-center gap-1 whitespace-nowrap"
              >
                Battlecards <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {data.competitorTelemetry.map((comp) => (
                <div key={comp.competitorName} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-900">
                      {comp.competitorName}
                    </span>
                    <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
                      <span className="text-slate-500">{comp.mentions} mentions</span>
                      <span className="font-semibold text-emerald-700">{comp.winRatePct}% win</span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#4F46E5] rounded-full"
                      style={{ width: `${comp.winRatePct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pilot Evaluation & Observability Card (PRD §15) */}
          <div className="eki-card rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#4F46E5]" />
                <h2 className="font-display text-[15px] font-semibold text-slate-900">
                  Pilot Quality &amp; Latency
                </h2>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-slate-500">
                P95 {data.evaluation.p95LatencyMs}ms
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-2.5">
                <div className="text-slate-500">Helpful / Used</div>
                <div className="font-mono text-sm font-bold text-emerald-700 tabular-nums mt-0.5">
                  {data.evaluation.helpfulCount + data.evaluation.usedCount} /{' '}
                  {data.evaluation.recommendationsShown}
                </div>
              </div>
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-2.5">
                <div className="text-slate-500">Cooldown Suppressed</div>
                <div className="font-mono text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                  {data.evaluation.duplicateSuppressedCount}
                </div>
              </div>
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-2.5">
                <div className="text-slate-500">Source Coverage</div>
                <div className="font-mono text-sm font-bold text-[#4338CA] tabular-nums mt-0.5">
                  {data.evaluation.sourceCoveragePct}%
                </div>
              </div>
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-2.5">
                <div className="text-slate-500">Abstentions / Err</div>
                <div className="font-mono text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                  {data.evaluation.abstentionCount} / {data.evaluation.incorrectCount}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Sales Intelligence Insights */}
      <section className="eki-card rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[16px] font-semibold text-slate-900">
              Recent Evidence-Backed Recommendations
            </h2>
            <p className="text-xs text-slate-500">
              Facts, AI interpretations, certainty labels, and supporting documents across meetings.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'competitor', label: 'Competitors' },
                { id: 'objection', label: 'Objections' },
                { id: 'buying_signal', label: 'Buying Signals' },
                { id: 'risk', label: 'Risks' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInsightFilter(tab.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  insightFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredInsights.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            No recommendations match this filter yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredInsights.map((insight) => {
              const badge = insightBadge(insight.category);
              return (
                <div
                  key={insight.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col justify-between space-y-3 hover:border-slate-300 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        {insight.category === 'risk' || insight.category === 'objection' ? (
                          <AlertTriangle className="w-3 h-3" />
                        ) : insight.category === 'competitor' ? (
                          <ShieldAlert className="w-3 h-3" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        {badge.label}
                      </span>
                      <span className="font-mono text-[11px] uppercase text-slate-500">
                        {insight.certainty} certainty · {insight.explicitOrInferred}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{insight.title}</h3>
                      <div className="mt-0.5 text-xs text-slate-500 flex items-center gap-1.5">
                        <span>{insight.accountName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{insight.createdAt}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      <span className="font-medium text-slate-800">Interpretation: </span>
                      {insight.interpretation}
                    </p>

                    <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-2.5 text-xs text-slate-800 leading-relaxed">
                      <span className="font-semibold text-[#4338CA]">Suggested Action: </span>
                      {insight.suggestedAction}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500 truncate">
                      {insight.supportingSources[0]?.title
                        ? `Source: ${insight.supportingSources[0].title}`
                        : insight.abstained
                        ? 'Abstained (No verified source)'
                        : 'No source cited'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenCopilot(insight.meetingId)}
                      className="text-[#4F46E5] hover:text-[#3525CD] font-medium whitespace-nowrap shrink-0"
                    >
                      Open Call →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
