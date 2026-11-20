import React from 'react';
import { Building2, CheckCircle2, Lock, ShieldCheck, Users } from 'lucide-react';
import type { AuditEvent, Organisation, UserProfile } from '../types/sales';

interface SettingsViewProps {
  organisation: Organisation | null;
  organisations: Organisation[];
  currentUser: UserProfile | null;
  users: UserProfile[];
  auditEvents: AuditEvent[];
  onSwitchOrg: (orgId: string) => void;
  onSaveSettings: (settings: Organisation['settings']) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  organisation,
  organisations,
  currentUser,
  users,
  auditEvents,
  onSwitchOrg,
  onSaveSettings,
}) => {
  const [retentionDays, setRetentionDays] = React.useState(90);
  const [cooldownSeconds, setCooldownSeconds] = React.useState(45);
  const [abstentionEnabled, setAbstentionEnabled] = React.useState(true);
  const [requireCaptureConsent, setRequireCaptureConsent] = React.useState(true);
  const [frameworkText, setFrameworkText] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [savedBanner, setSavedBanner] = React.useState(false);

  React.useEffect(() => {
    if (organisation) {
      setRetentionDays(organisation.settings.retentionDays);
      setCooldownSeconds(organisation.settings.cooldownSeconds);
      setAbstentionEnabled(organisation.settings.abstentionEnabled);
      setRequireCaptureConsent(organisation.settings.requireCaptureConsent);
      setFrameworkText(organisation.settings.qualificationFramework.join(', '));
    }
  }, [organisation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedBanner(false);
    try {
      await onSaveSettings({
        retentionDays: Number(retentionDays),
        cooldownSeconds: Number(cooldownSeconds),
        abstentionEnabled,
        requireCaptureConsent,
        qualificationFramework: frameworkText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Tenant / Organisation Switcher (Verifies Tenant Isolation) */}
      <div className="eki-card rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-[16px] font-semibold text-slate-900">
                Organisation Workspace &amp; Tenant Isolation
              </h2>
              <p className="text-xs text-slate-500">
                All meetings, knowledge chunks, embeddings, and battlecards are strictly isolated per organisation.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {organisations.map((org) => {
              const active = organisation?.id === org.id;
              return (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => onSwitchOrg(org.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-[#4F46E5] text-white border-[#4338CA]'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {org.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Privacy, Cooldown & Qualification Settings */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 eki-card rounded-lg p-5 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#4F46E5]" />
              <h3 className="font-display text-[15px] font-semibold text-slate-900">
                Privacy, Retention &amp; AI Guardrails
              </h3>
            </div>
            {savedBanner && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" /> Settings saved &amp; audited
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Transcript Retention Policy (Days)
              </label>
              <input
                type="number"
                min={0}
                max={365}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="eki-input w-full rounded-md px-3 py-2 text-[13px] font-mono tabular-nums"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                0 = ephemeral (raw transcripts are never persisted to disk); 1–365 = auto-purge completed transcripts after N days.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Duplicate Recommendation Cooldown (Seconds)
              </label>
              <input
                type="number"
                min={5}
                max={300}
                value={cooldownSeconds}
                onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                className="eki-input w-full rounded-md px-3 py-2 text-[13px] font-mono tabular-nums"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Suppresses repeated competitor/objection cards within this interval.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Configurable Qualification Framework (comma-separated)
            </label>
            <input
              type="text"
              value={frameworkText}
              onChange={(e) => setFrameworkText(e.target.value)}
              className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Default MEDDPICC fields tracked in real time during customer meetings.
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={abstentionEnabled}
                onChange={(e) => setAbstentionEnabled(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#4F46E5]"
              />
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Strict Evidence Abstention
                </div>
                <div className="text-xs text-slate-500">
                  Abstain and advise confirming with Solutions Engineering when no approved Knowledge Base source supports a claim.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={requireCaptureConsent}
                onChange={(e) => setRequireCaptureConsent(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#4F46E5]"
              />
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Participant Capture Notice &amp; Consent Check
                </div>
                <div className="text-xs text-slate-500">
                  Require explicit capture confirmation and show visible active/paused status during all live sessions.
                </div>
              </div>
            </label>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium"
            >
              {saving ? 'Saving...' : 'Save Organisation Settings'}
            </button>
          </div>
        </form>

        {/* Organisation Users & Role Access */}
        <div className="lg:col-span-5 eki-card rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#4F46E5]" />
              <h3 className="font-display text-[15px] font-semibold text-slate-900">
                Tenant Members &amp; Roles
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-500">{users.length} users</span>
          </div>

          <div className="divide-y divide-slate-100">
            {users.map((u) => (
              <div key={u.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {u.name} {currentUser?.id === u.id ? '(You)' : ''}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 whitespace-nowrap">
                  {u.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Administrative & Deletion Audit Log */}
      <div className="eki-card rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <h3 className="font-display text-[15px] font-semibold text-slate-900">
            Governance &amp; Audit Trail
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#F8FAFC] border-b border-slate-200">
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-3">Actor</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-4">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {auditEvents.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    No administrative events recorded in this tenant yet.
                  </td>
                </tr>
              ) : (
                auditEvents.map((ev) => (
                  <tr key={ev.id} className="bg-white">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(ev.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-slate-800 whitespace-nowrap">
                      {ev.actorName} · <span className="text-slate-500">{ev.actorRole}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#4338CA] whitespace-nowrap">
                      {ev.action}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">{ev.resource}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
