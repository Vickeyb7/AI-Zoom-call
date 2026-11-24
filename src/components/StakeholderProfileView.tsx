import React from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Mail,
  MessageSquareText,
  NotebookPen,
  RefreshCw,
  Search,
  Send,
  Users,
} from 'lucide-react';
import type {
  MeetingSession,
  MeetingStakeholderSummary,
  StakeholderNote,
} from '../types/sales';

interface StakeholderProfileViewProps {
  meeting: MeetingSession;
  apiHeaders: Record<string, string>;
  onCopyText: (text: string, label?: string) => void;
  onJumpToTurn?: (turnId?: string, excerpt?: string) => void;
  onCountChange?: (count: number) => void;
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function sentimentMeta(sentiment?: 'positive' | 'neutral' | 'cautious'): {
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

function noteSourceLabel(source: StakeholderNote['source']): string {
  if (source === 'crm_history') return 'CRM History';
  if (source === 'live_note') return 'Live Note';
  return 'Meeting Note';
}

export const StakeholderProfileView: React.FC<StakeholderProfileViewProps> = ({
  meeting,
  apiHeaders,
  onCopyText,
  onJumpToTurn,
  onCountChange,
}) => {
  const [stakeholders, setStakeholders] = React.useState<MeetingStakeholderSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [participantFilter, setParticipantFilter] = React.useState('');
  const [expandedHistory, setExpandedHistory] = React.useState<Record<string, boolean>>({});
  const [noteDraft, setNoteDraft] = React.useState('');
  const [savingNote, setSavingNote] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const loadedMeetingIdRef = React.useRef<string | null>(null);

  const fetchStakeholders = React.useCallback(
    async (silent: boolean) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await fetch(
          `/api/meetings/${encodeURIComponent(meeting.id)}/stakeholders`,
          { headers: apiHeaders },
        );
        const data = (await res.json()) as {
          stakeholders?: MeetingStakeholderSummary[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load stakeholder profiles');
        }
        const list = Array.isArray(data.stakeholders) ? data.stakeholders : [];
        setStakeholders(list);
        onCountChange?.(list.length);
        loadedMeetingIdRef.current = meeting.id;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load stakeholder profiles');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [meeting.id, apiHeaders, onCountChange],
  );

  React.useEffect(() => {
    const isSameMeeting = loadedMeetingIdRef.current === meeting.id;
    if (!isSameMeeting) {
      setSelectedId(null);
      setParticipantFilter('');
      setExpandedHistory({});
      setNoteDraft('');
      setSaveError(null);
    }
    void fetchStakeholders(isSameMeeting);
  }, [
    meeting.id,
    meeting.transcript.length,
    meeting.scratchpad.length,
    meeting.prospectStakeholders.length,
    fetchStakeholders,
  ]);

  const trimmedFilter = participantFilter.trim().toLowerCase();
  const visibleStakeholders = React.useMemo(() => {
    if (!trimmedFilter) return stakeholders;
    return stakeholders.filter(
      (p) =>
        p.name.toLowerCase().includes(trimmedFilter) ||
        p.role.toLowerCase().includes(trimmedFilter) ||
        p.buyingRole.toLowerCase().includes(trimmedFilter) ||
        p.focusAreas.some((f) => f.toLowerCase().includes(trimmedFilter)),
    );
  }, [stakeholders, trimmedFilter]);

  const activePerson =
    visibleStakeholders.find((p) => p.id === selectedId) ||
    visibleStakeholders[0] ||
    null;

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePerson || !noteDraft.trim() || savingNote) return;

    setSavingNote(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/meetings/${encodeURIComponent(meeting.id)}/stakeholders/notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...apiHeaders },
          body: JSON.stringify({
            stakeholderId: activePerson.id,
            stakeholderName: activePerson.name,
            stakeholderRole: activePerson.role,
            text: noteDraft.trim(),
          }),
        },
      );
      const data = (await res.json()) as {
        stakeholders?: MeetingStakeholderSummary[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Unable to save note');
      }
      if (Array.isArray(data.stakeholders)) {
        setStakeholders(data.stakeholders);
        onCountChange?.(data.stakeholders.length);
        // Keep selection aligned with persisted profile ID if profile was just created
        const updatedMatch = data.stakeholders.find(
          (s) => s.name.toLowerCase() === activePerson.name.toLowerCase(),
        );
        if (updatedMatch) {
          setSelectedId(updatedMatch.id);
        }
      }
      setNoteDraft('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save note');
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC]/40">
        <div className="flex gap-2">
          <div className="h-11 w-44 rounded-md bg-slate-200/70 animate-pulse" />
          <div className="h-11 w-44 rounded-md bg-slate-100 animate-pulse" />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 animate-pulse">
          <div className="h-4 w-48 bg-slate-200 rounded" />
          <div className="h-3 w-64 bg-slate-100 rounded" />
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="h-12 bg-slate-100 rounded" />
            <div className="h-12 bg-slate-100 rounded" />
            <div className="h-12 bg-slate-100 rounded" />
          </div>
          <div className="h-24 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto p-4 bg-[#F8FAFC]/40">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 space-y-2.5 text-xs text-rose-900">
          <div className="font-semibold">Unable to load stakeholder profiles</div>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchStakeholders(false)}
            className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (stakeholders.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6 bg-[#F8FAFC]/40 flex flex-col items-center justify-center text-center space-y-2">
        <Users className="w-6 h-6 text-slate-400" />
        <div className="text-sm font-semibold text-slate-800">
          No Participants Detected Yet
        </div>
        <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
          Stakeholder profiles appear automatically for scheduled attendees and as new speakers are detected in the live transcript.
        </p>
      </div>
    );
  }

  const isHistoryExpanded = activePerson ? Boolean(expandedHistory[activePerson.id]) : false;
  const visibleInteractions = activePerson
    ? isHistoryExpanded
      ? activePerson.previousInteractions
      : activePerson.previousInteractions.slice(0, 3)
    : [];
  const hasMoreInteractions = activePerson
    ? activePerson.previousInteractions.length > 3
    : false;
  const currentTone = activePerson?.latestSentiment
    ? sentimentMeta(activePerson.latestSentiment)
    : null;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#F8FAFC]/40">
      {/* Header & Detected Participant Switcher */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {stakeholders.length}{' '}
            {stakeholders.length === 1 ? 'detected participant' : 'detected participants'}
            {' · '}
            {stakeholders.filter((s) => s.detectedInCall).length} active in call
          </div>
          <button
            type="button"
            onClick={() => void fetchStakeholders(true)}
            disabled={refreshing}
            className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-60"
            title="Refresh stakeholder history"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {stakeholders.length >= 3 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={participantFilter}
              onChange={(e) => setParticipantFilter(e.target.value)}
              placeholder="Filter participants by name, role, or priority..."
              className="eki-input w-full rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-900"
            />
          </div>
        )}

        {/* Selectable Participant Strip */}
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Detected meeting participants"
        >
          {visibleStakeholders.map((person) => {
            const isSelected = activePerson?.id === person.id;
            return (
              <button
                key={person.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setSelectedId(person.id);
                  setSaveError(null);
                }}
                className={`text-left px-3 py-2 rounded-md border transition-colors flex items-center gap-2.5 min-w-0 max-w-full ${
                  isSelected
                    ? 'bg-white border-[#4F46E5] ring-1 ring-[#4F46E5]/20'
                    : 'bg-white/75 border-slate-200 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-md font-display text-[11px] font-semibold flex items-center justify-center shrink-0 ${
                    isSelected
                      ? 'bg-[#4F46E5] text-white'
                      : 'bg-[#EEF2FF] text-[#4338CA]'
                  }`}
                >
                  {getInitials(person.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate leading-tight">
                    {person.name}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate leading-tight mt-0.5 font-mono tabular-nums">
                    {person.detectedInCall
                      ? `In call · ${person.currentMeetingTurns} ${person.currentMeetingTurns === 1 ? 'turn' : 'turns'}`
                      : `Scheduled · ${person.previousInteractions.length} prior`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {!activePerson ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
          No participants matched &ldquo;{participantFilter.trim()}&rdquo;.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-200">
          {/* 1. Stakeholder Identity & Key Metrics */}
          <div className="p-4 space-y-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-md bg-[#EEF2FF] text-[#4338CA] font-display text-sm font-semibold flex items-center justify-center shrink-0">
                  {getInitials(activePerson.name)}
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-[15px] font-semibold text-slate-900 leading-snug truncate">
                    {activePerson.name}
                  </h3>
                  <div className="text-xs text-slate-600 leading-snug">
                    {activePerson.role} · {activePerson.accountName}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="font-medium text-[#4338CA]">
                      {activePerson.buyingRole}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {activePerson.detectedInCall ? 'Detected in live call' : 'Scheduled attendee'}
                    </span>
                    {currentTone && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${currentTone.className}`}>
                          {currentTone.label} tone
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {activePerson.email && (
                <button
                  type="button"
                  onClick={() =>
                    onCopyText(activePerson.email!, `Copied ${activePerson.name}'s email`)
                  }
                  title={`Copy ${activePerson.email}`}
                  className="eki-btn-secondary px-2.5 py-1.5 rounded-md text-[11px] font-medium inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  Copy Email
                </button>
              )}
            </div>

            {/* Compact Hairline Metric Strip */}
            <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-md border border-slate-200 bg-[#F8FAFC]">
              <div className="px-3 py-2">
                <div className="text-[11px] text-slate-500">Past Interactions</div>
                <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 mt-0.5">
                  {activePerson.previousInteractions.length}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[11px] text-slate-500">Turns in Call</div>
                <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 mt-0.5">
                  {activePerson.currentMeetingTurns}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[11px] text-slate-500">Historical Notes</div>
                <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 mt-0.5">
                  {activePerson.historicalNotes.length}
                </div>
              </div>
            </div>

            {/* Focus Areas / Priorities (Clean Unboxed Metadata) */}
            {activePerson.focusAreas.length > 0 && (
              <div className="text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-800">Known Priorities: </span>
                {activePerson.focusAreas.join(' · ')}
              </div>
            )}

            {/* Latest Live Call Statement */}
            {activePerson.detectedInCall && activePerson.latestTurnExcerpt && (
              <div className="rounded-md border border-indigo-200/80 bg-[#EEF2FF]/45 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-[#3730A3] inline-flex items-center gap-1.5">
                    <MessageSquareText className="w-3.5 h-3.5 text-[#4F46E5]" />
                    Latest Statement in Current Call
                  </span>
                  <div className="flex items-center gap-2">
                    {activePerson.latestTurnTimestamp && (
                      <span className="font-mono tabular-nums text-slate-500">
                        {activePerson.latestTurnTimestamp}
                      </span>
                    )}
                    {onJumpToTurn && activePerson.latestTurnId && (
                      <button
                        type="button"
                        onClick={() =>
                          onJumpToTurn(activePerson.latestTurnId, activePerson.latestTurnExcerpt)
                        }
                        className="text-[#4338CA] hover:underline font-medium inline-flex items-center gap-0.5 whitespace-nowrap"
                      >
                        Jump to turn
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-800 leading-relaxed">
                  &ldquo;{activePerson.latestTurnExcerpt}&rdquo;
                </p>
              </div>
            )}
          </div>

          {/* 2. Past Interactions Summary */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display text-xs font-semibold text-slate-900 inline-flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-slate-500" />
                Past Interactions ({activePerson.previousInteractions.length})
              </h4>
              {hasMoreInteractions && (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedHistory((prev) => ({
                      ...prev,
                      [activePerson.id]: !prev[activePerson.id],
                    }))
                  }
                  className="text-[11px] font-medium text-[#4F46E5] hover:underline inline-flex items-center gap-0.5"
                >
                  {isHistoryExpanded ? (
                    <>
                      Show less <ChevronUp className="w-3 h-3" />
                    </>
                  ) : (
                    <>
                      Show all ({activePerson.previousInteractions.length}){' '}
                      <ChevronDown className="w-3 h-3" />
                    </>
                  )}
                </button>
              )}
            </div>

            {visibleInteractions.length === 0 ? (
              <p className="text-xs text-slate-500 leading-relaxed">
                No prior meetings or touchpoints recorded for {activePerson.name} before this call.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleInteractions.map((item) => {
                  const tone = sentimentMeta(item.sentiment);
                  return (
                    <div key={item.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono tabular-nums text-slate-600 shrink-0">
                            {item.date}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.channel}</span>
                        </div>
                        <span className={`font-medium shrink-0 ${tone.className}`}>
                          {tone.label}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-900 leading-snug">
                        {item.meetingTitle}
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">{item.summary}</p>
                      {item.keyExcerpt && (
                        <p className="text-[11px] text-slate-500 italic leading-relaxed">
                          &ldquo;{item.keyExcerpt}&rdquo;
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Historical Notes & Add Note Form */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display text-xs font-semibold text-slate-900 inline-flex items-center gap-1.5">
                <NotebookPen className="w-3.5 h-3.5 text-slate-500" />
                Historical Notes ({activePerson.historicalNotes.length})
              </h4>
              <span className="text-[11px] text-slate-400">
                Synced across account meetings
              </span>
            </div>

            <form onSubmit={(e) => void handleSaveNote(e)} className="flex items-center gap-2">
              <input
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                disabled={savingNote}
                placeholder={`Add a persistent note for ${activePerson.name}...`}
                className="eki-input flex-1 rounded-md px-3 py-1.5 text-xs text-slate-900"
              />
              <button
                type="submit"
                disabled={!noteDraft.trim() || savingNote}
                className="eki-btn-primary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                {savingNote ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Save Note
              </button>
            </form>

            {saveError && (
              <div className="text-[11px] text-rose-700">{saveError}</div>
            )}

            {activePerson.historicalNotes.length === 0 ? (
              <p className="text-xs text-slate-500 leading-relaxed">
                No historical notes recorded yet. Save preferences, objections, or decision criteria above to carry context into future calls.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {activePerson.historicalNotes.map((note) => (
                  <div key={note.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium text-slate-700">
                          {noteSourceLabel(note.source)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{note.author}</span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-400 shrink-0">
                        {note.createdAt}
                      </span>
                    </div>
                    <p className="text-xs text-slate-800 leading-relaxed">{note.text}</p>
                    {note.meetingTitle && (
                      <div className="text-[11px] text-slate-400 truncate">
                        From: {note.meetingTitle}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
