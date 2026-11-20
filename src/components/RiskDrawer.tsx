import React from 'react';
import { AlertTriangle, Check, Copy, ShieldAlert, TrendingUp, X } from 'lucide-react';
import type { Battlecard, MeetingSession } from '../types/sales';

interface RiskDrawerProps {
  open: boolean;
  onClose: () => void;
  meeting: MeetingSession;
  battlecard?: Battlecard;
  onCopyText: (text: string, label?: string) => void;
}

export const RiskDrawer: React.FC<RiskDrawerProps> = ({
  open,
  onClose,
  meeting,
  battlecard,
  onCopyText,
}) => {
  const [copiedIdx, setCopiedIdx] = React.useState<string | null>(null);

  if (!open) return null;

  const riskInsights = meeting.insights.filter(
    (i) => i.category === 'risk' || i.category === 'objection' || i.category === 'competitor',
  );

  const handleCopy = (id: string, text: string) => {
    onCopyText(text, 'Counter copied');
    setCopiedIdx(id);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-[#0F172A]/40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className="relative z-10 w-full max-w-[420px] bg-white h-full border-l border-slate-200 eki-drawer flex flex-col"
        aria-label="Risk and Competitor Warning Drawer"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-[#FFF1F2] border border-[#FECDD3] flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4 text-[#E11D48]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-[16px] font-semibold text-slate-900 truncate">
                Risk &amp; Competitor Defense
              </h2>
              <p className="text-xs text-slate-500 truncate">
                {meeting.accountName} · vs {meeting.primaryCompetitor}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Active Deal Risks &amp; Objections
              </h3>
              <span className="font-mono text-xs tabular-nums text-[#E11D48] font-semibold">
                {riskInsights.length} flagged
              </span>
            </div>

            {riskInsights.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                No critical deal blockers or competitor threats detected in this session yet.
              </div>
            ) : (
              <div className="space-y-3">
                {riskInsights.map((risk) => (
                  <div
                    key={risk.id}
                    className="rounded-lg bg-[#FFF1F2] border border-[#FECDD3] p-3.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#9F1239]">
                        <AlertTriangle className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
                        <span>{risk.title}</span>
                      </div>
                      <span className="font-mono text-[11px] uppercase text-[#BE123C] shrink-0">
                        {risk.certainty} certainty
                      </span>
                    </div>
                    <p className="text-xs text-[#881337] leading-relaxed">{risk.interpretation}</p>
                    <div className="bg-white/90 border border-[#FECDD3] rounded-md p-2.5 space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-700">
                        Recommended Action
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed">
                        {risk.suggestedResponse || risk.suggestedAction}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy(risk.id, risk.suggestedResponse || risk.suggestedAction)
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4F46E5] hover:text-[#3525CD]"
                      >
                        {copiedIdx === risk.id ? (
                          <>
                            <Check className="w-3 h-3" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy Talk Track
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {battlecard && (
            <section className="space-y-3 pt-2 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {battlecard.competitorName} Attack Plan
                </h3>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 font-mono tabular-nums">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {battlecard.winRatePct}% Win Rate
                </span>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                <div className="text-xs font-semibold text-slate-800">
                  Pricing Dispute Strategy
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {battlecard.pricingCounterStrategy}
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-800">
                  Rapid Claim-to-Counter Playbook
                </div>
                {battlecard.quickCounters.map((qc, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5"
                  >
                    <div className="text-[11px] font-medium text-amber-800">
                      Claim: &ldquo;{qc.claim}&rdquo;
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">{qc.counter}</p>
                    <button
                      type="button"
                      onClick={() => handleCopy(`qc-${idx}`, qc.counter)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4F46E5] hover:text-[#3525CD]"
                    >
                      {copiedIdx === `qc-${idx}` ? (
                        <>
                          <Check className="w-3 h-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy Counter
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};
