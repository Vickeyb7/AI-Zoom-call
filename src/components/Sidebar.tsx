import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  LayoutDashboard,
  LogOut,
  PauseCircle,
  Radio,
  Settings,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { MeetingSession, Organisation, UserProfile } from '../types/sales';

export type NavTab = 'dashboard' | 'copilot' | 'knowledge' | 'battlecards' | 'meetings' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  liveMeeting?: MeetingSession;
  wsConnected: boolean;
  meetings: MeetingSession[];
  selectedMeetingId: string;
  onOpenMeeting: (meetingId: string) => void;
  organisation: Organisation | null;
  currentUser: UserProfile | null;
  googleUser?: {
    name: string;
    email: string;
    photoURL?: string;
  };
  onSignOut?: () => void;
}

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'copilot', label: 'Live Copilot', icon: Radio },
  { id: 'knowledge', label: 'Knowledge Base', icon: Database },
  { id: 'battlecards', label: 'Battlecards', icon: ShieldAlert },
  { id: 'meetings', label: 'Meetings', icon: FileText },
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'settings', label: 'Settings & Privacy', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  collapsed,
  onToggleCollapse,
  liveMeeting,
  wsConnected,
  meetings,
  selectedMeetingId,
  onOpenMeeting,
  organisation,
  currentUser,
  googleUser,
  onSignOut,
}) => {
  const [avatarFailed, setAvatarFailed] = React.useState(false);
  const displayName = googleUser?.name || currentUser?.name || 'Workspace User';
  const displaySubtitle = googleUser?.email || currentUser?.role || 'Organisation Admin';
  const avatarSrc = googleUser?.photoURL || '';
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || 'U';
  const isPaused = liveMeeting?.status === 'paused';

  return (
    <aside
      className={`flex flex-col bg-[#0B1120] text-slate-200 border-r border-slate-800/90 shrink-0 transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[72px]' : 'w-[252px]'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800/80">
        <button
          type="button"
          onClick={() => onSelectTab('copilot')}
          className="flex items-center gap-2.5 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md"
        >
          <div className="w-8 h-8 rounded-md bg-[#4F46E5] border border-[#6366F1]/50 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display text-[15px] font-bold tracking-tight text-white truncate">
                AI Sales Strategist
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {organisation?.name || 'Enterprise Tenant'}
              </div>
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors shrink-0"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Live Meeting Radar Pill */}
      {liveMeeting && (
        <div className="px-3 pt-4 pb-1">
          <button
            type="button"
            onClick={() => onOpenMeeting(liveMeeting.id)}
            title={`Jump to call: ${liveMeeting.accountName}`}
            className={`w-full text-left rounded-full bg-[#0F172A] border border-slate-700/80 hover:border-emerald-500/60 transition-colors ${
              collapsed ? 'p-2 flex items-center justify-center' : 'px-3.5 py-2'
            }`}
          >
            {collapsed ? (
              <span className="relative flex h-2.5 w-2.5">
                {!isPaused && wsConnected && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    isPaused ? 'bg-amber-400' : wsConnected ? 'bg-emerald-500' : 'bg-slate-500'
                  }`}
                />
              </span>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isPaused ? (
                      <PauseCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <span className="relative flex h-2 w-2 shrink-0">
                        {wsConnected && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        )}
                        <span
                          className={`relative inline-flex rounded-full h-2 w-2 ${
                            wsConnected ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />
                      </span>
                    )}
                    <span
                      className={`text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${
                        isPaused ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {isPaused ? 'Session Paused' : 'Live Session'}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                    {liveMeeting.durationMinutes}m
                  </span>
                </div>
                <div className="text-xs font-medium text-white truncate">
                  {liveMeeting.accountName}
                </div>
                <div className="font-mono text-[11px] text-slate-300 tabular-nums">
                  Rep {liveMeeting.aeTalkRatio}% / Prospect {liveMeeting.prospectTalkRatio}%
                </div>
              </div>
            )}
          </button>
        </div>
      )}

      {/* Main Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#4F46E5] text-white'
                  : 'text-slate-300 hover:bg-[#0F172A] hover:text-white'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}

        {/* Quick Deal Switcher */}
        {!collapsed && meetings.length > 0 && (
          <div className="pt-5">
            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Tenant Deal Rooms
            </div>
            <div className="space-y-1">
              {meetings.slice(0, 4).map((m) => {
                const isSelected = activeTab === 'copilot' && selectedMeetingId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onOpenMeeting(m.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                      isSelected
                        ? 'bg-[#1E293B] text-white'
                        : 'text-slate-400 hover:bg-[#0F172A] hover:text-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{m.accountName}</div>
                      <div className="text-[11px] text-slate-500 truncate">{m.stage}</div>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
                      ${Math.round(m.dealValue / 1000)}k
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Authenticated Google User Footer */}
      <div className="p-3 border-t border-slate-800/80 bg-[#0F172A]/60 space-y-2.5">
        <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-9 h-9 rounded-full overflow-hidden border border-slate-700 bg-[#1E293B] shrink-0 flex items-center justify-center text-xs font-semibold text-indigo-300">
            {avatarSrc && !avatarFailed ? (
              <img
                src={avatarSrc}
                alt={displayName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-white truncate">
                {displayName}
              </div>
              <div className="text-[11px] text-slate-400 truncate" title={displaySubtitle}>
                {displaySubtitle}
              </div>
            </div>
          )}
          {onSignOut && !collapsed && (
            <button
              type="button"
              onClick={onSignOut}
              title="Sign out of Google account"
              aria-label="Sign out"
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {onSignOut && collapsed && (
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out of Google account"
            aria-label="Sign out"
            className="w-full p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
};
