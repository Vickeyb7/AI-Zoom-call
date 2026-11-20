import React from 'react';
import {
  AlertOctagon,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  Lightbulb,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { Battlecard } from '../types/sales';

interface BattlecardsViewProps {
  battlecards: Battlecard[];
  onRefresh: () => Promise<void>;
  onCopyText: (text: string, label?: string) => void;
  apiHeaders: Record<string, string>;
}

export const BattlecardsView: React.FC<BattlecardsViewProps> = ({
  battlecards,
  onRefresh,
  onCopyText,
  apiHeaders,
}) => {
  const [selectedId, setSelectedId] = React.useState<string>(battlecards[0]?.id || '');
  const [showGenModal, setShowGenModal] = React.useState(false);
  const [competitorInput, setCompetitorInput] = React.useState('');
  const [generating, setGenerating] = React.useState(false);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');

  const filteredBattlecards = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return battlecards;
    return battlecards.filter(
      (bc) =>
        bc.competitorName.toLowerCase().includes(q) ||
        (bc.aliases || []).some((a) => a.toLowerCase().includes(q)) ||
        bc.tagline.toLowerCase().includes(q) ||
        bc.theirWeaknesses.some((w) => w.toLowerCase().includes(q)),
    );
  }, [battlecards, searchQuery]);

  React.useEffect(() => {
    if (battlecards.length === 0) {
      setSelectedId('');
      return;
    }
    if (!selectedId || !battlecards.some((b) => b.id === selectedId)) {
      setSelectedId(battlecards[0].id);
    }
  }, [battlecards, selectedId]);

  const activeCard =
    filteredBattlecards.find((b) => b.id === selectedId) ||
    battlecards.find((b) => b.id === selectedId) ||
    filteredBattlecards[0] ||
    battlecards[0];

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!competitorInput.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/battlecards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...apiHeaders },
        body: JSON.stringify({ competitorName: competitorInput.trim() }),
      });
      const data = (await res.json()) as Battlecard & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate battlecard');
      }
      await onRefresh();
      setSelectedId(data.id);
      setCompetitorInput('');
      setShowGenModal(false);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = (key: string, text: string) => {
    onCopyText(text, 'Copied to clipboard');
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Competitive Battlecards
          </h2>
          <p className="text-xs text-slate-500">
            Tenant-approved counter-positioning, deterministic aliases, landmine questions, and prohibited claim guardrails.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowGenModal(true)}
          className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Generate Battlecard from KB
        </button>
      </div>

      {battlecards.length === 0 ? (
        <div className="eki-card rounded-lg p-10 text-center space-y-2">
          <ShieldAlert className="w-6 h-6 text-slate-400 mx-auto" />
          <div className="text-sm font-semibold text-slate-900">
            No battlecards indexed in this organisation yet
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Upload competitive docs to the Knowledge Base or synthesize a new battlecard using Groq AI + RAG.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Competitor List */}
          <div className="lg:col-span-4 space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Filter ${battlecards.length} competitors, aliases, weaknesses...`}
                className="eki-input w-full rounded-md pl-8 pr-3 py-2 text-xs text-slate-900"
              />
            </div>
            <div className="space-y-2.5 max-h-[calc(100vh-290px)] overflow-y-auto pr-0.5">
            {filteredBattlecards.map((bc) => {
              const active = activeCard?.id === bc.id;
              return (
                <button
                  key={bc.id}
                  type="button"
                  onClick={() => setSelectedId(bc.id)}
                  className={`w-full text-left rounded-lg p-4 border transition-colors ${
                    active
                      ? 'bg-white border-[#4F46E5] eki-ai-glow'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[15px] font-semibold text-slate-900">
                      {bc.competitorName}
                    </span>
                    <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700 bg-[#ECFDF5] border border-[#A7F3D0] px-2 py-0.5 rounded">
                      {bc.winRatePct}% Win
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 line-clamp-2">{bc.tagline}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums text-slate-500">
                    <span>{bc.dealsTracked} deals</span>
                    <span aria-hidden="true">·</span>
                    <span>{bc.avgDiscountPressurePct}% discount pressure</span>
                    <span aria-hidden="true">·</span>
                    <span>Review {bc.reviewDate}</span>
                  </div>
                </button>
              );
            })}
            </div>
          </div>

          {/* Selected Battlecard Matrix */}
          {activeCard && (
            <div className="lg:col-span-8 eki-card rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 bg-white flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <h3 className="font-display text-lg font-bold text-slate-900">
                      {activeCard.competitorName}
                    </h3>
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 border border-slate-200 bg-[#F8FAFC] px-2 py-0.5 rounded">
                      <CalendarClock className="w-3 h-3" />
                      Review {activeCard.reviewDate}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{activeCard.tagline}</p>
                  {activeCard.aliases.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Tracked Aliases:
                      </span>
                      {activeCard.aliases.map((alias) => (
                        <span
                          key={alias}
                          className="font-mono text-[11px] text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded"
                        >
                          {alias}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 font-mono text-xs tabular-nums shrink-0">
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Win Rate</div>
                    <div className="font-bold text-emerald-700 flex items-center gap-1 justify-end">
                      <TrendingUp className="w-3.5 h-3.5" /> {activeCard.winRatePct}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Deals</div>
                    <div className="font-bold text-slate-900">{activeCard.dealsTracked}</div>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Prohibited / Unverified Claims Guardrail (PRD §10) */}
                {activeCard.prohibitedClaims && activeCard.prohibitedClaims.length > 0 && (
                  <div className="rounded-lg border border-[#FECDD3] bg-[#FFF1F2]/70 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#9F1239]">
                      <AlertOctagon className="w-4 h-4 shrink-0" />
                      Prohibited / Unverified Claims — Do Not Use
                    </div>
                    <ul className="space-y-1.5 text-xs text-[#881337]">
                      {activeCard.prohibitedClaims.map((claim, idx) => (
                        <li key={idx} className="flex items-start gap-2 leading-relaxed">
                          <span className="font-bold">×</span>
                          <span>{claim}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Strengths vs Weaknesses & Our Differentiators */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 space-y-2.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Where {activeCard.competitorName} Struggles
                    </h4>
                    <ul className="space-y-2 text-xs text-slate-700">
                      {activeCard.theirWeaknesses.map((w, i) => (
                        <li key={i} className="flex items-start gap-2 leading-relaxed">
                          <span className="text-amber-600 font-bold">•</span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-lg border border-[#E0E7FF] bg-[#EEF2FF]/45 p-4 space-y-2.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#4338CA]">
                      Our Winning Differentiators
                    </h4>
                    <ul className="space-y-2 text-xs text-slate-800">
                      {activeCard.ourDifferentiators.map((d, i) => (
                        <li key={i} className="flex items-start gap-2 leading-relaxed">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#4F46E5] shrink-0 mt-0.5" />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Their Strengths (Verified Context) */}
                {activeCard.theirStrengths.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Competitor Strengths to Acknowledge Honestly
                    </h4>
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-700">
                      {activeCard.theirStrengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 leading-relaxed">
                          <span className="text-slate-400 font-bold">•</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Landmine Discovery Questions */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Landmine Discovery Questions
                  </h4>
                  <div className="space-y-2">
                    {activeCard.landmineQuestions.map((q, idx) => (
                      <div
                        key={idx}
                        className="rounded-md border border-slate-200 bg-white p-3 flex items-start justify-between gap-3"
                      >
                        <div className="flex items-start gap-2 text-xs text-slate-800 leading-relaxed">
                          <Lightbulb className="w-4 h-4 text-[#0284C7] shrink-0 mt-0.5" />
                          <span>{q}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(`lq-${idx}`, q)}
                          className="text-xs text-[#4F46E5] hover:text-[#3525CD] font-medium shrink-0 inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          {copiedKey === `lq-${idx}` ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pricing Counter Strategy */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Pricing &amp; TCO Counter Strategy
                  </h4>
                  <p className="text-[13px] text-slate-800 leading-relaxed">
                    {activeCard.pricingCounterStrategy}
                  </p>
                </div>

                {/* Claim vs Counter Table */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Objection &amp; Claim Counters
                  </h4>
                  <div className="space-y-2.5">
                    {activeCard.quickCounters.map((qc, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3.5 space-y-2"
                      >
                        <div className="text-xs font-semibold text-amber-900">
                          Prospect Says: &ldquo;{qc.claim}&rdquo;
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs text-slate-800 leading-relaxed">{qc.counter}</p>
                          <button
                            type="button"
                            onClick={() => handleCopy(`qc-${idx}`, qc.counter)}
                            className="eki-btn-secondary px-2.5 py-1 rounded text-[11px] font-medium shrink-0 inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            {copiedKey === `qc-${idx}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" /> Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" /> Copy
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Generate Battlecard Modal */}
      {showGenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F172A]/45">
          <div className="bg-white rounded-lg border border-slate-200 w-full max-w-md eki-drawer p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Generate Battlecard via RAG
              </h3>
              <button
                type="button"
                onClick={() => setShowGenModal(false)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Groq AI will search your tenant Knowledge Base documents and build a structured battlecard with aliases, landmine questions, objection counters, and prohibited claims.
            </p>
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Competitor Name
                </label>
                <input
                  type="text"
                  required
                  value={competitorInput}
                  onChange={(e) => setCompetitorInput(e.target.value)}
                  placeholder="e.g. Snowflake, Gong, DataStream Pro"
                  className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                />
              </div>
              {genError && (
                <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] px-3 py-2 text-xs text-[#9F1239]">
                  {genError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGenModal(false)}
                  className="eki-btn-secondary px-4 py-2 rounded-md text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Synthesizing...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Build Battlecard
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
