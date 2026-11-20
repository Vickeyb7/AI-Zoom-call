import React from 'react';
import {
  Activity,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  History,
  Loader2,
  Mail,
  Play,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import type {
  MeetingSession,
  MeetingStakeholderSummary,
  MeetingStatus,
} from '../types/sales';

interface MeetingsArchiveViewProps {
  meetings: MeetingSession[];
  onOpenCopilot: (meetingId: string) => void;
  onRefresh: () => Promise<void>;
  onCopyText: (text: string, label?: string) => void;
  apiHeaders: Record<string, string>;
}

const STATUS_TABS: ('all' | MeetingStatus)[] = ['all', 'active', 'paused', 'completed', 'created'];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function sentimentTone(sentiment?: 'positive' | 'neutral' | 'cautious'): {
  label: string;
  className: string;
} {
  if (sentiment === 'positive') {
    return { label: 'Constructive', className: 'text-emerald-700' };
  }
  if (sentiment === 'cautious') {
    return { label: 'Cautious', className: 'text-amber-700' };
  }
  return { label: 'Neutral', className: 'text-slate-500' };
}

export const MeetingsArchiveView: React.FC<MeetingsArchiveViewProps> = ({
  meetings,
  onOpenCopilot,
  onRefresh,
  onCopyText,
  apiHeaders,
}) => {
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | MeetingStatus>('all');
  const [selectedId, setSelectedId] = React.useState<string>(meetings[0]?.id || '');
  const [generatingSummary, setGeneratingSummary] = React.useState(false);
  const [summaryError, setSummaryError] = React.useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = React.useState(false);

  const [stakeholders, setStakeholders] = React.useState<MeetingStakeholderSummary[]>([]);
  const [loadingStakeholders, setLoadingStakeholders] = React.useState(false);
  const [stakeholdersError, setStakeholdersError] = React.useState<string | null>(null);
  const [expandedHistoryIds, setExpandedHistoryIds] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (meetings.length === 0) {
      setSelectedId('');
      return;
    }
    if (!selectedId || !meetings.some((m) => m.id === selectedId)) {
      setSelectedId(meetings[0].id);
    }
  }, [meetings, selectedId]);

  const filtered = meetings.filter((m) => {
    const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      m.accountName.toLowerCase().includes(q) ||
      m.title.toLowerCase().includes(q) ||
      m.primaryCompetitor.toLowerCase().includes(q) ||
      m.prospectStakeholders.some((s) => s.toLowerCase().includes(q));
    return matchesStatus && matchesSearch;
  });

  const selected = filtered.find((m) => m.id === selectedId) || filtered[0] || null;

  React.useEffect(() => {
    if (!selected) {
      setStakeholders([]);
      setStakeholdersError(null);
      return;
    }

    let cancelled = false;
    setLoadingStakeholders(true);
    setStakeholdersError(null);
    setExpandedHistoryIds({});

    fetch(`/api/meetings/${encodeURIComponent(selected.id)}/stakeholders`, {
      headers: apiHeaders,
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          stakeholders?: MeetingStakeholderSummary[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load stakeholder profiles');
        }
        if (!cancelled) {
          setStakeholders(Array.isArray(data.stakeholders) ? data.stakeholders : []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStakeholders([]);
          setStakeholdersError(
            err instanceof Error ? err.message : 'Unable to load stakeholder history',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStakeholders(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.transcript.length, apiHeaders]);

  const handleGenerateSummary = async (meetingId: string) => {
    setGeneratingSummary(true);
    setSummaryError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/summary`, {
        method: 'POST',
        headers: apiHeaders,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate summary');
      }
      await onRefresh();
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Summary failed');
    } finally {
      setGeneratingSummary(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Status Filter Bar */}
      <div className="eki-card rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by account, stakeholder, deal title, or competitor..."
            className="eki-input w-full rounded-md pl-9 pr-3 py-2 text-[13px]"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {STATUS_TABS.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Split View: Table + Stakeholder Profiles & Executive Post-Call Detail */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 eki-card rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#F8FAFC] border-b border-slate-200">
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Account</th>
                  <th className="py-2.5 px-3">State</th>
                  <th className="py-2.5 px-3">Competitor</th>
                  <th className="py-2.5 px-3 text-right">Value</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[13px]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                      No meetings match the selected filter in this organisation.
                    </td>
                  </tr>
                ) : (
                  filtered.map((m, idx) => {
                    const isSel = selected?.id === m.id;
                    return (
                      <tr
                        key={m.id}
                        onClick={() => setSelectedId(m.id)}
                        className={`cursor-pointer transition-colors ${
                          isSel
                            ? 'bg-[#EEF2FF]/70'
                            : idx % 2 === 1
                            ? 'bg-[#FAFAFA] hover:bg-slate-50'
                            : 'bg-white hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{m.accountName}</div>
                          <div className="text-xs text-slate-500">
                            {m.stage} · {m.prospectStakeholders.length}{' '}
                            {m.prospectStakeholders.length === 1 ? 'stakeholder' : 'stakeholders'} ·{' '}
                            {m.transcript.length} turns
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs capitalize whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              m.status === 'active'
                                ? 'text-emerald-700'
                                : m.status === 'paused'
                                ? 'text-amber-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {m.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs font-medium text-amber-800 whitespace-nowrap">
                          {m.primaryCompetitor}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-slate-900">
                          ${m.dealValue.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenCopilot(m.id);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-[#4F46E5] bg-[#EEF2FF] hover:bg-[#4F46E5] hover:text-white transition-colors"
                          >
                            <Play className="w-3 h-3" /> Copilot
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stakeholder Profiles + Post-Call Executive Summary & Follow-Up */}
        {selected && (
          <div className="xl:col-span-5 eki-card rounded-lg p-5 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-[16px] font-semibold text-slate-900 truncate">
                  {selected.accountName}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {selected.title}
                </p>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                  {selected.platform} · {selected.stage} · {selected.startedAt.slice(0, 10)}
                </div>
              </div>
              <button
                type="button"
                disabled={generatingSummary || selected.transcript.length === 0}
                onClick={() => void handleGenerateSummary(selected.id)}
                className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {generatingSummary ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Summarizing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    AI Summary &amp; Email
                  </>
                )}
              </button>
            </div>

            {/* Qualification & Signal Telemetry Snapshot */}
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 px-3 py-2">
                <div className="text-[11px] text-slate-500">MEDDPICC Covered</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 mt-0.5">
                  {selected.qualification.filter((q) => q.covered).length}/
                  {selected.qualification.length} fields
                </div>
              </div>
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 px-3 py-2">
                <div className="text-[11px] text-slate-500">Signal Events</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 mt-0.5 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[#4F46E5]" />
                  {selected.signals.length} detected ({selected.suppressedDuplicatesCount} merged)
                </div>
              </div>
            </div>

            {/* Stakeholder Profiles & Database Interaction History */}
            <div className="space-y-3 pt-1 border-t border-slate-200">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#4F46E5]" />
                  <h4 className="font-display text-[13px] font-semibold text-slate-900">
                    Stakeholder Profiles
                  </h4>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">
                  {selected.prospectStakeholders.length}{' '}
                  {selected.prospectStakeholders.length === 1 ? 'attendee' : 'attendees'}
                </span>
              </div>

              {loadingStakeholders ? (
                <div className="space-y-2.5">
                  {selected.prospectStakeholders.map((_, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3.5 animate-pulse space-y-2"
                    >
                      <div className="h-3.5 w-40 bg-slate-200 rounded" />
                      <div className="h-3 w-56 bg-slate-200 rounded" />
                      <div className="h-10 w-full bg-slate-100 rounded" />
                    </div>
                  ))}
                </div>
              ) : stakeholdersError ? (
                <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] px-3 py-2 text-xs text-[#9F1239]">
                  {stakeholdersError}
                </div>
              ) : stakeholders.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-[#F8FAFC] p-4 text-xs text-slate-500">
                  No stakeholders recorded for this meeting.
                </div>
              ) : (
                <div className="space-y-3">
                  {stakeholders.map((person) => {
                    const isExpanded = Boolean(expandedHistoryIds[person.id]);
                    const visibleHistory = isExpanded
                      ? person.previousInteractions
                      : person.previousInteractions.slice(0, 2);
                    const hasMore = person.previousInteractions.length > 2;

                    return (
                      <div
                        key={person.id}
                        className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3"
                      >
                        {/* Profile Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-md bg-[#EEF2FF] text-[#4338CA] font-display text-xs font-semibold flex items-center justify-center shrink-0">
                              {getInitials(person.name)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-slate-900 leading-snug truncate">
                                {person.name}
                              </div>
                              <div className="text-xs text-slate-600 leading-snug">
                                {person.role}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
                                <span className="font-medium text-[#4338CA]">
                                  {person.buyingRole}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  {person.previousInteractions.length} prior
                                </span>
                                {person.currentMeetingTurns > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">
                                      {person.currentMeetingTurns} turns in call
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {person.email && (
                            <button
                              type="button"
                              onClick={() =>
                                onCopyText(person.email!, `Copied ${person.name}'s email`)
                              }
                              title={`Copy ${person.email}`}
                              className="p-1.5 rounded-md text-slate-400 hover:text-[#4F46E5] hover:bg-[#EEF2FF]/60 transition-colors shrink-0"
                              aria-label={`Copy email for ${person.name}`}
                            >
                              <Mail className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Focus Areas (Clean unboxed metadata) */}
                        {person.focusAreas.length > 0 && (
                          <div className="text-[11px] text-slate-600 leading-relaxed">
                            <span className="font-medium text-slate-700">Priorities: </span>
                            {person.focusAreas.join(' · ')}
                          </div>
                        )}

                        {/* Previous Interaction History */}
                        <div className="pt-2.5 border-t border-slate-100 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                              <History className="w-3 h-3 text-slate-400" />
                              Previous Interaction History
                            </span>
                            {hasMore && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedHistoryIds((prev) => ({
                                    ...prev,
                                    [person.id]: !prev[person.id],
                                  }))
                                }
                                className="inline-flex items-center gap-0.5 text-[#4F46E5] hover:underline font-medium"
                              >
                                {isExpanded ? (
                                  <>
                                    Show less <ChevronUp className="w-3 h-3" />
                                  </>
                                ) : (
                                  <>
                                    All {person.previousInteractions.length}{' '}
                                    <ChevronDown className="w-3 h-3" />
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          {visibleHistory.length === 0 ? (
                            <p className="text-[11px] text-slate-500">
                              No previous interaction history found in the database — first recorded touchpoint.
                            </p>
                          ) : (
                            <div className="divide-y divide-slate-100">
                              {visibleHistory.map((item) => {
                                const tone = sentimentTone(item.sentiment);
                                const linkedMeetingExists =
                                  Boolean(item.meetingId) &&
                                  meetings.some((m) => m.id === item.meetingId);
                                return (
                                  <div
                                    key={item.id}
                                    className="py-2 first:pt-0 last:pb-0 space-y-1"
                                  >
                                    <div className="flex items-baseline justify-between gap-2">
                                      <div className="text-xs font-medium text-slate-800 leading-snug min-w-0">
                                        {linkedMeetingExists ? (
                                          <button
                                            type="button"
                                            onClick={() => setSelectedId(item.meetingId!)}
                                            className="inline-flex items-center gap-1 text-left text-[#4338CA] hover:underline"
                                          >
                                            <span className="truncate">{item.meetingTitle}</span>
                                            <ArrowUpRight className="w-3 h-3 shrink-0" />
                                          </button>
                                        ) : (
                                          <span>{item.meetingTitle}</span>
                                        )}
                                      </div>
                                      <span className="font-mono text-[10.5px] tabular-nums text-slate-400 shrink-0">
                                        {item.date}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                      <span>{item.channel}</span>
                                      <span aria-hidden="true">·</span>
                                      <span className={tone.className}>{tone.label}</span>
                                    </div>

                                    <p className="text-xs text-slate-600 leading-relaxed">
                                      {item.summary}
                                    </p>

                                    {item.keyExcerpt && (
                                      <p className="text-[11px] text-slate-500 italic leading-snug">
                                        &ldquo;{item.keyExcerpt}&rdquo;
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {summaryError && (
              <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] px-3 py-2 text-xs text-[#9F1239]">
                {summaryError}
              </div>
            )}

            {selected.executiveSummary ? (
              <div className="space-y-4 pt-1 border-t border-slate-200">
                <div className="rounded-md bg-[#F8FAFC] border border-slate-200 p-3.5 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    Observed Facts (Transcript Grounded)
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-800">
                    {selected.executiveSummary.facts.map((fact, i) => (
                      <li key={i} className="flex items-start gap-2 leading-relaxed">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {selected.executiveSummary.interpretations.length > 0 && (
                  <div className="rounded-md bg-[#EEF2FF]/45 border border-[#E0E7FF] p-3.5 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4338CA]">
                      AI Interpretations (Verify Before Committing)
                    </div>
                    <ul className="space-y-1.5 text-xs text-slate-800">
                      {selected.executiveSummary.interpretations.map((interp, i) => (
                        <li key={i} className="flex items-start gap-2 leading-relaxed">
                          <span className="text-[#4F46E5] font-bold">•</span>
                          <span>{interp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-800">Agreed Next Steps</div>
                  <ul className="space-y-1 text-xs text-slate-700">
                    {selected.executiveSummary.nextSteps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="font-mono text-[#4F46E5] font-semibold">{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Draft Follow-Up Email
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onCopyText(selected.executiveSummary!.followUpEmail, 'Follow-up email copied');
                        setCopiedEmail(true);
                        setTimeout(() => setCopiedEmail(false), 1500);
                      }}
                      className="text-xs font-medium text-[#4F46E5] hover:text-[#3525CD] inline-flex items-center gap-1"
                    >
                      {copiedEmail ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy Email
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {selected.executiveSummary.followUpEmail}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center space-y-2 border border-dashed border-slate-200 rounded-lg bg-[#F8FAFC]">
                <FileText className="w-5 h-5 text-slate-400 mx-auto" />
                <p className="text-xs text-slate-600 max-w-xs mx-auto">
                  {selected.transcript.length === 0
                    ? 'No transcript turns recorded yet. Open Copilot to start this meeting.'
                    : 'Click "AI Summary & Email" to separate observed transcript facts from AI interpretations, next steps, and a customer follow-up draft.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
