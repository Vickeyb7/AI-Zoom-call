import React from 'react';
import { Building2, Loader2, PictureInPicture2, Plus, Radio, X } from 'lucide-react';
import { Sidebar, type NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { LiveCopilotView } from './components/LiveCopilotView';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { BattlecardsView } from './components/BattlecardsView';
import { MeetingsArchiveView } from './components/MeetingsArchiveView';
import { TranscriptAnalyzerView } from './components/TranscriptAnalyzerView';
import { SettingsView } from './components/SettingsView';
import { RiskDrawer } from './components/RiskDrawer';
import { DesktopHUDView } from './components/DesktopHUDView';
import { CornerCopilotHud } from './components/CornerCopilotHud';
import { ZoomConnectModal } from './components/ZoomConnectModal';
import { LoginGate } from './components/LoginGate';
import {
  ONBOARDING_MODES,
  OnboardingWizardModal,
  QuickStartChecklistBanner,
} from './components/OnboardingFlow';
import { useAuth } from './components/FirebaseAuthProvider';
import { useLiveAudioCapture } from './hooks/useLiveAudioCapture';
import type {
  AuditEvent,
  Battlecard,
  CopilotPreferences,
  CopilotSessionMode,
  DashboardData,
  DealStage,
  DisplayDensity,
  FeedbackRating,
  KnowledgeDoc,
  MeetingSession,
  Organisation,
  QuickAnswerSpeed,
  QuickAnswerStyle,
  SessionContextConfig,
  SpeakerRole,
  UserProfile,
} from './types/sales';

const TAB_TITLES: Record<NavTab, string> = {
  copilot: 'Live Meeting Copilot',
  transcript_analyzer: 'Transcript Strategy & Sentiment Analyzer',
  knowledge: 'Knowledge Base & RAG Index',
  battlecards: 'Competitive Battlecards',
  meetings: 'Meetings Archive',
  dashboard: 'Executive Overview',
  settings: 'Settings & Privacy Governance',
};

interface OrgContextResponse {
  organisation: Organisation;
  currentUser: UserProfile;
  organisations: Organisation[];
  users: UserProfile[];
  auditEvents: AuditEvent[];
}

interface AuthenticatedWorkspaceProps {
  googleUser: {
    uid: string;
    name: string;
    email: string;
    photoURL?: string;
  };
  idToken: string | null;
  onSignOut: () => Promise<void>;
}

function AuthenticatedWorkspace({
  googleUser,
  idToken,
  onSignOut,
}: AuthenticatedWorkspaceProps) {
  const [activeTab, setActiveTab] = React.useState<NavTab>('copilot');
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  const [activeOrgId, setActiveOrgId] = React.useState<string>('org-acme');
  const [organisations, setOrganisations] = React.useState<Organisation[]>([]);
  const [currentOrg, setCurrentOrg] = React.useState<Organisation | null>(null);
  const [currentUser, setCurrentUser] = React.useState<UserProfile | null>(null);
  const [orgUsers, setOrgUsers] = React.useState<UserProfile[]>([]);
  const [auditEvents, setAuditEvents] = React.useState<AuditEvent[]>([]);

  const [dashboard, setDashboard] = React.useState<DashboardData | null>(null);
  const [meetings, setMeetings] = React.useState<MeetingSession[]>([]);
  const [docs, setDocs] = React.useState<KnowledgeDoc[]>([]);
  const [battlecards, setBattlecards] = React.useState<Battlecard[]>([]);
  const [loading, setLoading] = React.useState(true);

  const initialParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isElectronHud =
    typeof window !== 'undefined' && Boolean(window.desktopHud?.isElectron);
  const [desktopHudMode, setDesktopHudMode] = React.useState<boolean>(
    () => isElectronHud && initialParams?.get('mode') === 'desktop-hud',
  );
  const [cornerHudOpen, setCornerHudOpen] = React.useState<boolean>(
    () => !isElectronHud && initialParams?.get('mode') === 'desktop-hud',
  );
  const [selectedMeetingId, setSelectedMeetingId] = React.useState<string>(
    () => initialParams?.get('meetingId') || 'mtg-demo-lambdatest',
  );
  const [wsConnected, setWsConnected] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [quickAnswering, setQuickAnswering] = React.useState(false);
  const [quickAnswerQuestion, setQuickAnswerQuestion] = React.useState<string | null>(null);
  const [copilotError, setCopilotError] = React.useState<string | null>(null);

  const [riskDrawerOpen, setRiskDrawerOpen] = React.useState(false);
  const [zoomModalOpen, setZoomModalOpen] = React.useState(false);
  const [newMeetingModalOpen, setNewMeetingModalOpen] = React.useState(false);
  const [onboardingOpen, setOnboardingOpen] = React.useState(false);
  const [onboardingStep, setOnboardingStep] = React.useState<1 | 2 | 3>(1);
  const [preferencesLoaded, setPreferencesLoaded] = React.useState(false);
  const autoOpenedOnboardingRef = React.useRef(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [preferences, setPreferences] = React.useState<CopilotPreferences>(() => {
    try {
      const saved = window.localStorage.getItem('ais_copilot_preferences');
      if (saved) return JSON.parse(saved) as CopilotPreferences;
    } catch {
      // Ignore storage errors
    }
    return {
      density: 'standard',
      hudPosition: 'bottom-right',
      hudOpacity: 96,
      showSourcesExpanded: false,
    };
  });

  // New Meeting Form State
  const [newAccount, setNewAccount] = React.useState('');
  const [newTitle, setNewTitle] = React.useState('');
  const [newPlatform, setNewPlatform] = React.useState<MeetingSession['platform']>('Simulator');
  const [newDealValue, setNewDealValue] = React.useState('250000');
  const [newStage, setNewStage] = React.useState<DealStage>('Discovery');
  const [newCompetitor, setNewCompetitor] = React.useState('ApexCloud');
  const [newStakeholder, setNewStakeholder] = React.useState('');
  const [newConsentConfirmed, setNewConsentConfirmed] = React.useState(true);
  const [creatingMeeting, setCreatingMeeting] = React.useState(false);

  const wsRef = React.useRef<WebSocket | null>(null);

  const apiHeaders = React.useMemo<Record<string, string>>(
    () => ({
      'x-org-id': activeOrgId,
      ...(currentUser ? { 'x-user-id': currentUser.id } : {}),
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(googleUser.email ? { 'x-auth-email': googleUser.email } : {}),
      ...(googleUser.name ? { 'x-auth-name': googleUser.name } : {}),
    }),
    [activeOrgId, currentUser, idToken, googleUser.email, googleUser.name],
  );

  const showToast = React.useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((curr) => (curr === msg ? null : curr)), 2400);
  }, []);

  const handleCopyText = React.useCallback(
    (text: string, label = 'Copied to clipboard') => {
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text);
      }
      showToast(label);
    },
    [showToast],
  );

  const fetchAllData = React.useCallback(async () => {
    const tenantHeaders = { 'x-org-id': activeOrgId };
    try {
      const [ctxRes, dashRes, mtgRes, kbRes, bcRes] = await Promise.all([
        fetch('/api/org/context', { headers: tenantHeaders }),
        fetch('/api/dashboard', { headers: tenantHeaders }),
        fetch('/api/meetings', { headers: tenantHeaders }),
        fetch('/api/knowledge', { headers: tenantHeaders }),
        fetch('/api/battlecards', { headers: tenantHeaders }),
      ]);
      const [ctxData, dashData, mtgData, kbData, bcData] = (await Promise.all([
        ctxRes.json(),
        dashRes.json(),
        mtgRes.json(),
        kbRes.json(),
        bcRes.json(),
      ])) as [
        OrgContextResponse,
        DashboardData,
        MeetingSession[],
        KnowledgeDoc[],
        Battlecard[],
      ];

      setCurrentOrg(ctxData.organisation);
      setCurrentUser(ctxData.currentUser);
      setOrganisations(ctxData.organisations);
      setOrgUsers(ctxData.users);
      setAuditEvents(ctxData.auditEvents);

      setDashboard(dashData);
      setMeetings(mtgData);
      setDocs(kbData);
      setBattlecards(bcData);
      setSelectedMeetingId((prev) =>
        mtgData.some((m) => m.id === prev) ? prev : mtgData[0]?.id || '',
      );
      if (bcData.length > 0 && !bcData.some((b) => b.competitorName === newCompetitor)) {
        setNewCompetitor(bcData[0].competitorName);
      }
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  React.useEffect(() => {
    setLoading(true);
    void fetchAllData();
  }, [fetchAllData]);

  // Load persisted user preferences from backend
  React.useEffect(() => {
    let active = true;
    fetch('/api/preferences', { headers: apiHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CopilotPreferences | null) => {
        if (!active) return;
        if (data) {
          setPreferences(data);
          try {
            window.localStorage.setItem('ais_copilot_preferences', JSON.stringify(data));
          } catch {
            // Ignore storage errors
          }
        }
        setPreferencesLoaded(true);
      })
      .catch(() => {
        if (active) setPreferencesLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [apiHeaders]);

  const updatePreferences = React.useCallback(
    (patch: Partial<CopilotPreferences>) => {
      setPreferences((prev) => {
        const next: CopilotPreferences = {
          ...prev,
          ...patch,
          onboardingChecklist: patch.onboardingChecklist
            ? { ...(prev.onboardingChecklist || {}), ...patch.onboardingChecklist }
            : prev.onboardingChecklist,
        };
        try {
          window.localStorage.setItem('ais_copilot_preferences', JSON.stringify(next));
        } catch {
          // Ignore
        }
        return next;
      });
      void fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...apiHeaders },
        body: JSON.stringify(patch),
      }).catch(() => {
        // Non-fatal
      });
    },
    [apiHeaders],
  );

  const handleChangeDensity = React.useCallback(
    (density: DisplayDensity) => {
      updatePreferences({ density });
    },
    [updatePreferences],
  );

  // Open onboarding wizard automatically once for brand-new users
  React.useEffect(() => {
    if (
      !preferencesLoaded ||
      loading ||
      autoOpenedOnboardingRef.current ||
      desktopHudMode
    ) {
      return;
    }
    autoOpenedOnboardingRef.current = true;
    if (!preferences.onboardingCompleted && !preferences.onboardingDismissed) {
      setOnboardingStep(1);
      setOnboardingOpen(true);
    }
  }, [
    preferencesLoaded,
    loading,
    desktopHudMode,
    preferences.onboardingCompleted,
    preferences.onboardingDismissed,
  ]);

  // Passively record checklist milestones as user explores key workspace surfaces
  React.useEffect(() => {
    if (!preferencesLoaded) return;
    if (
      (activeTab === 'knowledge' || activeTab === 'battlecards') &&
      !preferences.onboardingChecklist?.knowledgeReviewed
    ) {
      updatePreferences({ onboardingChecklist: { knowledgeReviewed: true } });
    }
  }, [activeTab, preferencesLoaded, preferences.onboardingChecklist?.knowledgeReviewed, updatePreferences]);

  React.useEffect(() => {
    if (!preferencesLoaded) return;
    if ((cornerHudOpen || desktopHudMode) && !preferences.onboardingChecklist?.stealthHudExplored) {
      updatePreferences({ onboardingChecklist: { stealthHudExplored: true } });
    }
  }, [cornerHudOpen, desktopHudMode, preferencesLoaded, preferences.onboardingChecklist?.stealthHudExplored, updatePreferences]);

  // WebSocket Connection & Auto-Reconnect
  React.useEffect(() => {
    let closedByEffect = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        if (selectedMeetingId) {
          ws.send(
            JSON.stringify({
              type: 'meeting:join',
              orgId: activeOrgId,
              userId: currentUser?.id,
              meetingId: selectedMeetingId,
            }),
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as {
            type: string;
            meeting?: MeetingSession;
            analyzing?: boolean;
            generating?: boolean;
            question?: string;
            error?: string;
          };

          if (typeof payload.analyzing === 'boolean') {
            setAnalyzing(payload.analyzing);
          }

          if (payload.type === 'quick_answer:generating') {
            setQuickAnswering(Boolean(payload.generating));
            if (payload.generating && payload.question) {
              setQuickAnswerQuestion(payload.question);
            } else if (!payload.generating) {
              setQuickAnswerQuestion(null);
            }
          }

          if (
            (payload.type === 'meeting:state' ||
              payload.type === 'copilot:update' ||
              payload.type === 'quick_answer:ready') &&
            payload.meeting
          ) {
            const updated = payload.meeting;
            if (updated.organisationId !== activeOrgId) return;

            setMeetings((prev) => {
              const exists = prev.some((m) => m.id === updated.id);
              return exists
                ? prev.map((m) => (m.id === updated.id ? updated : m))
                : [updated, ...prev];
            });
            setDashboard((prev) =>
              prev
                ? {
                    ...prev,
                    recentMeetings: prev.recentMeetings.map((m) =>
                      m.id === updated.id ? updated : m,
                    ),
                    recentInsights: [
                      ...updated.insights.filter((i) => !i.dismissed),
                      ...prev.recentInsights.filter((i) => i.meetingId !== updated.id),
                    ].slice(0, 10),
                  }
                : prev,
            );
            if (payload.type === 'copilot:update' || payload.type === 'quick_answer:ready') {
              setCopilotError(null);
            }
            if (payload.type === 'quick_answer:ready') {
              setQuickAnswering(false);
              setQuickAnswerQuestion(null);
            }
          }

          if (payload.type === 'copilot:error') {
            setAnalyzing(false);
            setQuickAnswering(false);
            setCopilotError(payload.error || 'Real-time AI analysis failed');
          }
        } catch {
          // Ignore malformed WS payloads
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByEffect) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [activeOrgId]);

  // Re-join WS room when selectedMeetingId or tenant changes
  React.useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && selectedMeetingId) {
      wsRef.current.send(
        JSON.stringify({
          type: 'meeting:join',
          orgId: activeOrgId,
          userId: currentUser?.id,
          meetingId: selectedMeetingId,
        }),
      );
    }
  }, [selectedMeetingId, activeOrgId, currentUser?.id]);

  const sendWsMessage = (data: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          ...data,
          orgId: activeOrgId,
          userId: currentUser?.id,
        }),
      );
    } else {
      setCopilotError('WebSocket reconnecting—please retry in a moment.');
    }
  };

  const handleOpenMeetingInCopilot = (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    setCopilotError(null);
    setActiveTab('copilot');
  };

  const handleSwitchOrg = (orgId: string) => {
    if (orgId === activeOrgId) return;
    setActiveOrgId(orgId);
    setCopilotError(null);
    const nextOrg = organisations.find((o) => o.id === orgId);
    if (nextOrg) {
      showToast(`Switched tenant workspace to ${nextOrg.name}`);
    }
  };

  const handleSaveOrgSettings = async (settings: Organisation['settings']) => {
    const res = await fetch('/api/org/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...apiHeaders },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      showToast(err.error || 'Failed to save organisation settings');
      return;
    }
    await fetchAllData();
    showToast('Organisation privacy & AI guardrail settings updated');
  };

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccount.trim()) return;
    setCreatingMeeting(true);
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...apiHeaders },
        body: JSON.stringify({
          accountName: newAccount.trim(),
          title: newTitle.trim() || `${newAccount.trim()} — Live Call`,
          platform: newPlatform,
          dealValue: Number(newDealValue) || 200000,
          stage: newStage,
          primaryCompetitor: newCompetitor,
          stakeholders: newStakeholder.trim()
            ? newStakeholder.split(',').map((s) => s.trim())
            : ['VP Engineering (Prospect)'],
          captureConsentConfirmed: newConsentConfirmed,
        }),
      });
      const created = (await res.json()) as MeetingSession;
      if (res.ok) {
        await fetchAllData();
        setSelectedMeetingId(created.id);
        setActiveTab('copilot');
        setNewAccount('');
        setNewTitle('');
        setNewStakeholder('');
        setNewMeetingModalOpen(false);
        showToast(`Copilot session opened for ${created.accountName}`);
      }
    } finally {
      setCreatingMeeting(false);
    }
  };

  const selectedMeeting =
    meetings.find((m) => m.id === selectedMeetingId) || meetings[0] || null;
  const liveMeeting = meetings.find((m) => m.status === 'active' || m.status === 'paused');
  const matchedBattlecard = selectedMeeting
    ? battlecards.find(
        (b) =>
          b.competitorName.toLowerCase() === selectedMeeting.primaryCompetitor.toLowerCase() ||
          b.aliases.some(
            (a) => a.toLowerCase() === selectedMeeting.primaryCompetitor.toLowerCase(),
          ),
      )
    : undefined;

  const { audioState, startCapture, stopCapture, setMicSpeaker, uploadAudioFile } =
    useLiveAudioCapture({
      meetingId: selectedMeeting?.id || selectedMeetingId,
      prospectName: selectedMeeting?.prospectStakeholders[0] || 'Zoom Prospect',
      repName: selectedMeeting ? `${selectedMeeting.aeName} (You)` : 'Sales Rep',
      apiHeaders,
      onError: (msg) => setCopilotError(msg),
    });

  const handleRequestQuickAnswer = React.useCallback(
    async (params: {
      question?: string;
      style: QuickAnswerStyle;
      speed: QuickAnswerSpeed;
      refineAction?: 'shorter' | 'more_detail' | 'regenerate';
      previousAnswer?: string;
    }) => {
      if (!selectedMeeting) return;
      setQuickAnswering(true);
      setQuickAnswerQuestion(params.question || null);
      setCopilotError(null);
      try {
        const res = await fetch(`/api/meetings/${selectedMeeting.id}/quick-answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...apiHeaders },
          body: JSON.stringify(params),
        });
        const data = (await res.json()) as { meeting?: MeetingSession; error?: string };
        if (!res.ok) {
          throw new Error(data.error || 'Quick answer generation failed');
        }
        if (data.meeting) {
          setMeetings((prev) =>
            prev.map((m) => (m.id === data.meeting!.id ? data.meeting! : m)),
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Quick answer generation failed';
        setCopilotError(message);
        showToast(message);
      } finally {
        setQuickAnswering(false);
        setQuickAnswerQuestion(null);
      }
    },
    [selectedMeeting, apiHeaders, showToast],
  );

  const handleUpdateSessionContext = React.useCallback(
    async (patch: Partial<SessionContextConfig>) => {
      if (!selectedMeeting) return;
      try {
        const res = await fetch(`/api/meetings/${selectedMeeting.id}/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...apiHeaders },
          body: JSON.stringify(patch),
        });
        const updated = (await res.json()) as MeetingSession;
        if (res.ok) {
          setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          if (patch.userBackground !== undefined || patch.customInstructions !== undefined) {
            showToast('Copilot context saved');
          }
        }
      } catch {
        showToast('Failed to save session context');
      }
    },
    [selectedMeeting, apiHeaders, showToast],
  );

  const handleEnterDesktopHud = () => {
    if (isElectronHud) {
      setDesktopHudMode(true);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('mode', 'desktop-hud');
        if (selectedMeetingId) url.searchParams.set('meetingId', selectedMeetingId);
        window.history.replaceState({}, '', url.toString());
      }
      return;
    }

    // In regular browser tabs, pin the compact Stealth Overlay to a corner so the full screen stays interactive
    setCornerHudOpen(true);
    showToast('Stealth Overlay active — press Alt+H anytime to hide or restore');
  };

  const handleRunOnboardingPracticeQuestion = React.useCallback(
    (mode: CopilotSessionMode, preferredStyle: QuickAnswerStyle) => {
      const modeMeta = ONBOARDING_MODES.find((m) => m.id === mode) || ONBOARDING_MODES[0];
      setActiveTab('copilot');
      setOnboardingOpen(false);
      updatePreferences({
        onboardingCompleted: true,
        onboardingChecklist: {
          goalConfigured: true,
          liveSessionTested: true,
        },
      });
      if (!selectedMeeting) return;
      if (selectedMeeting.status === 'created') {
        sendWsMessage({
          type: 'meeting:status',
          meetingId: selectedMeeting.id,
          status: 'active',
          captureConsentConfirmed: true,
        });
      }
      sendWsMessage({
        type: 'transcript:add',
        meetingId: selectedMeeting.id,
        eventId: `evt-onboard-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        speaker: 'Prospect',
        speakerName: modeMeta.sampleQuestion.speakerName,
        text: modeMeta.sampleQuestion.text,
      });
      void handleRequestQuickAnswer({
        question: modeMeta.sampleQuestion.text,
        style: preferredStyle,
        speed: 'fast',
      });
      showToast('Live practice question sent — watch the instant answer appear');
    },
    [selectedMeeting, sendWsMessage, handleRequestQuickAnswer, updatePreferences, showToast],
  );

  const effectiveChecklist = {
    goalConfigured: Boolean(
      preferences.onboardingChecklist?.goalConfigured ||
        selectedMeeting?.sessionContext?.userBackground?.trim(),
    ),
    knowledgeReviewed: Boolean(preferences.onboardingChecklist?.knowledgeReviewed),
    liveSessionTested: Boolean(
      preferences.onboardingChecklist?.liveSessionTested ||
        (selectedMeeting && selectedMeeting.transcript.length > 0) ||
        audioState.capturing,
    ),
    stealthHudExplored: Boolean(
      preferences.onboardingChecklist?.stealthHudExplored || cornerHudOpen || desktopHudMode,
    ),
  };

  const allChecklistComplete =
    effectiveChecklist.goalConfigured &&
    effectiveChecklist.knowledgeReviewed &&
    effectiveChecklist.liveSessionTested &&
    effectiveChecklist.stealthHudExplored;

  const showQuickStartChecklist =
    preferencesLoaded &&
    !onboardingOpen &&
    !preferences.onboardingChecklistDismissed &&
    !allChecklistComplete &&
    (activeTab === 'copilot' || activeTab === 'dashboard');

  const handleExitDesktopHud = () => {
    setDesktopHudMode(false);
    setCornerHudOpen(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      url.searchParams.delete('meetingId');
      window.history.replaceState({}, '', url.toString());
    }
  };

  if (desktopHudMode && isElectronHud) {
    return (
      <>
        <DesktopHUDView
          meetings={meetings}
          selectedMeeting={selectedMeeting}
          battlecards={battlecards}
          wsConnected={wsConnected}
          analyzing={analyzing}
          copilotError={copilotError}
          audioState={audioState}
          onStartAudioCapture={startCapture}
          onStopAudioCapture={stopCapture}
          onSelectMeeting={(id) => {
            setSelectedMeetingId(id);
            setCopilotError(null);
          }}
          onSendTurn={(speaker: SpeakerRole, speakerName: string, text: string) => {
            if (!selectedMeeting) return;
            sendWsMessage({
              type: 'transcript:add',
              meetingId: selectedMeeting.id,
              eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              speaker,
              speakerName,
              text,
            });
          }}
          onInsightAction={(insightId, action) => {
            if (!selectedMeeting) return;
            sendWsMessage({
              type: 'insight:action',
              meetingId: selectedMeeting.id,
              insightId,
              action,
            });
          }}
          onInsightFeedback={(insightId: string, rating: FeedbackRating) => {
            if (!selectedMeeting) return;
            sendWsMessage({
              type: 'insight:feedback',
              meetingId: selectedMeeting.id,
              insightId,
              rating,
            });
            showToast('Recommendation marked useful');
          }}
          onCopyText={handleCopyText}
          onOpenZoomModal={() => setZoomModalOpen(true)}
          onExitDesktopHud={handleExitDesktopHud}
        />

        {selectedMeeting && (
          <ZoomConnectModal
            open={zoomModalOpen}
            meeting={selectedMeeting}
            apiHeaders={apiHeaders}
            audioState={audioState}
            onStartAudioCapture={startCapture}
            onStopAudioCapture={stopCapture}
            onSetMicSpeaker={setMicSpeaker}
            onUploadAudioFile={uploadAudioFile}
            onSendTurn={(speaker: SpeakerRole, speakerName: string, text: string) => {
              sendWsMessage({
                type: 'transcript:add',
                meetingId: selectedMeeting.id,
                eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                speaker,
                speakerName,
                text,
              });
            }}
            onClose={() => setZoomModalOpen(false)}
            onCopyText={handleCopyText}
            onSwitchToDesktopHud={handleEnterDesktopHud}
          />
        )}

        {toast && (
          <div className="fixed bottom-3 right-3 z-50 rounded-md bg-[#0F172A] text-white px-3 py-2 text-xs font-medium eki-popover border border-slate-700">
            {toast}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-[#0F172A]">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        liveMeeting={liveMeeting}
        wsConnected={wsConnected}
        meetings={meetings}
        selectedMeetingId={selectedMeetingId}
        onOpenMeeting={handleOpenMeetingInCopilot}
        organisation={currentOrg}
        currentUser={currentUser}
        googleUser={googleUser}
        onSignOut={() => void onSignOut()}
        onOpenOnboarding={() => {
          setOnboardingStep(1);
          setOnboardingOpen(true);
        }}
        setupIncomplete={!allChecklistComplete}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Workspace Bar */}
        <header className="h-16 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-400 font-medium whitespace-nowrap">
              AI Sales Strategist
            </span>
            <span className="text-slate-300" aria-hidden="true">
              /
            </span>
            <h1 className="font-display font-semibold text-slate-900 truncate">
              {TAB_TITLES[activeTab]}
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {organisations.length > 1 && (
              <div className="hidden md:flex items-center gap-1.5 border border-slate-200 rounded-md px-2.5 py-1 bg-[#F8FAFC]">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                <select
                  aria-label="Switch organisation tenant"
                  value={activeOrgId}
                  onChange={(e) => handleSwitchOrg(e.target.value)}
                  className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
                >
                  {organisations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {liveMeeting && activeTab !== 'copilot' && (
              <button
                type="button"
                onClick={() => handleOpenMeetingInCopilot(liveMeeting.id)}
                className="eki-btn-secondary px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Radio
                  className={`w-3.5 h-3.5 ${
                    liveMeeting.status === 'paused' ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                />
                {liveMeeting.status === 'paused' ? 'Paused:' : 'Live:'} {liveMeeting.accountName}
              </button>
            )}
            <button
              type="button"
              onClick={() => setCornerHudOpen((prev) => !prev)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                cornerHudOpen
                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              title="Open semi-transparent stealth overlay HUD (Alt+H to quick hide)"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
              {cornerHudOpen ? 'Stealth HUD On' : 'Stealth HUD'}
            </button>
            <button
              type="button"
              onClick={() => setNewMeetingModalOpen(true)}
              className="eki-btn-primary px-3.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              New Live Call
            </button>
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 p-5 max-w-[1600px] w-full mx-auto">
          {showQuickStartChecklist && (
            <QuickStartChecklistBanner
              checklist={effectiveChecklist}
              onOpenWizard={(step = 1) => {
                setOnboardingStep(step);
                setOnboardingOpen(true);
              }}
              onOpenKnowledgeBase={() => {
                setActiveTab('knowledge');
                updatePreferences({ onboardingChecklist: { knowledgeReviewed: true } });
              }}
              onConnectAudio={() => {
                setActiveTab('copilot');
                setZoomModalOpen(true);
              }}
              onRunSampleQuestion={() => {
                const mode = selectedMeeting?.sessionContext?.mode || 'sales_call';
                const style = selectedMeeting?.sessionContext?.preferredStyle || 'concise';
                handleRunOnboardingPracticeQuestion(mode, style);
              }}
              onOpenStealthHud={() => {
                handleEnterDesktopHud();
                updatePreferences({ onboardingChecklist: { stealthHudExplored: true } });
              }}
              onDismiss={() => {
                updatePreferences({ onboardingChecklistDismissed: true });
                showToast('Checklist hidden — reopen Setup Guide anytime from the sidebar');
              }}
            />
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              data={dashboard}
              loading={loading}
              onOpenCopilot={handleOpenMeetingInCopilot}
              onStartNewMeeting={() => setNewMeetingModalOpen(true)}
              onNavigateBattlecards={() => setActiveTab('battlecards')}
              onNavigateKnowledge={() => setActiveTab('knowledge')}
            />
          )}

          {activeTab === 'copilot' && (
            <LiveCopilotView
              meetings={meetings}
              selectedMeeting={selectedMeeting}
              battlecards={battlecards}
              apiHeaders={apiHeaders}
              wsConnected={wsConnected}
              analyzing={analyzing}
              quickAnswering={quickAnswering}
              quickAnswerQuestion={quickAnswerQuestion}
              copilotError={copilotError}
              onSelectMeeting={(id) => {
                setSelectedMeetingId(id);
                setCopilotError(null);
              }}
              onSendTurn={(speaker: SpeakerRole, speakerName: string, text: string) => {
                if (!selectedMeeting) return;
                sendWsMessage({
                  type: 'transcript:add',
                  meetingId: selectedMeeting.id,
                  eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  speaker,
                  speakerName,
                  text,
                });
              }}
              onRequestQuickAnswer={handleRequestQuickAnswer}
              onUpdateSessionContext={handleUpdateSessionContext}
              onPushScratchpad={(text, sourceTitle) => {
                if (!selectedMeeting) return;
                sendWsMessage({
                  type: 'scratchpad:add',
                  meetingId: selectedMeeting.id,
                  text,
                  sourceTitle,
                });
                showToast('Pinned to call notes');
              }}
              onInsightAction={(insightId, action) => {
                if (!selectedMeeting) return;
                sendWsMessage({
                  type: 'insight:action',
                  meetingId: selectedMeeting.id,
                  insightId,
                  action,
                });
              }}
              onInsightFeedback={(insightId: string, rating: FeedbackRating) => {
                if (!selectedMeeting) return;
                sendWsMessage({
                  type: 'insight:feedback',
                  meetingId: selectedMeeting.id,
                  insightId,
                  rating,
                });
                showToast('Recommendation marked useful');
              }}
              onUpdateMeetingStatus={(status: MeetingSession['status'], consent?: boolean) => {
                if (!selectedMeeting) return;
                sendWsMessage({
                  type: 'meeting:status',
                  meetingId: selectedMeeting.id,
                  status,
                  captureConsentConfirmed: consent,
                });
                const label =
                  status === 'paused'
                    ? 'Meeting paused'
                    : status === 'completed'
                    ? 'Meeting ended — generating decisions recap...'
                    : 'Meeting live';
                showToast(label);
              }}
              onResetMeeting={(meetingId: string) => {
                sendWsMessage({
                  type: 'meeting:reset',
                  meetingId,
                });
                setCopilotError(null);
                showToast('Simulated meeting reset');
              }}
              onOpenRiskDrawer={() => setRiskDrawerOpen(true)}
              onOpenNewMeetingModal={() => setNewMeetingModalOpen(true)}
              onOpenZoomConnect={() => setZoomModalOpen(true)}
              onOpenStealthHud={handleEnterDesktopHud}
              audioState={audioState}
              onStopAudioCapture={stopCapture}
              onCopyText={handleCopyText}
              density={preferences.density}
              onChangeDensity={handleChangeDensity}
              onRegenerateSummary={async (meetingId: string) => {
                showToast('Synthesizing meeting decisions recap...');
                try {
                  const res = await fetch(`/api/meetings/${meetingId}/summary`, {
                    method: 'POST',
                    headers: apiHeaders,
                  });
                  if (!res.ok) {
                    const data = (await res.json()) as { error?: string };
                    throw new Error(data.error || 'Recap generation failed');
                  }
                  await fetchAllData();
                  showToast('Meeting recap updated');
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Recap generation failed');
                }
              }}
            />
          )}

          {activeTab === 'knowledge' && (
            <KnowledgeBaseView
              docs={docs}
              loading={loading}
              onRefresh={fetchAllData}
              apiHeaders={apiHeaders}
            />
          )}

          {activeTab === 'battlecards' && (
            <BattlecardsView
              battlecards={battlecards}
              onRefresh={fetchAllData}
              onCopyText={handleCopyText}
              apiHeaders={apiHeaders}
            />
          )}

          {activeTab === 'transcript_analyzer' && (
            <TranscriptAnalyzerView
              apiHeaders={apiHeaders}
              battlecards={battlecards}
              onCopyText={handleCopyText}
              onRefresh={fetchAllData}
              onOpenMeetingsArchive={() => setActiveTab('meetings')}
            />
          )}

          {activeTab === 'meetings' && (
            <MeetingsArchiveView
              meetings={meetings}
              onOpenCopilot={handleOpenMeetingInCopilot}
              onRefresh={fetchAllData}
              onCopyText={handleCopyText}
              apiHeaders={apiHeaders}
              onOpenTranscriptAnalyzer={() => setActiveTab('transcript_analyzer')}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              organisation={currentOrg}
              organisations={organisations}
              currentUser={currentUser}
              users={orgUsers}
              auditEvents={auditEvents}
              onSwitchOrg={handleSwitchOrg}
              onSaveSettings={handleSaveOrgSettings}
            />
          )}
        </main>
      </div>

      {/* Guided Onboarding Workflow Modal */}
      <OnboardingWizardModal
        open={onboardingOpen}
        initialStep={onboardingStep}
        userName={googleUser.name || currentUser?.name}
        currentContext={selectedMeeting?.sessionContext}
        indexedDocsCount={docs.length}
        battlecardsCount={battlecards.length}
        onSaveContext={async (patch) => {
          await handleUpdateSessionContext(patch);
          updatePreferences({
            onboardingChecklist: { goalConfigured: true },
          });
        }}
        onOpenKnowledgeBase={() => {
          setOnboardingOpen(false);
          setActiveTab('knowledge');
          updatePreferences({
            onboardingCompleted: true,
            onboardingChecklist: { knowledgeReviewed: true },
          });
        }}
        onConnectAudio={() => {
          setOnboardingOpen(false);
          setActiveTab('copilot');
          setZoomModalOpen(true);
          updatePreferences({
            onboardingCompleted: true,
            onboardingChecklist: { goalConfigured: true },
          });
        }}
        onRunPracticeQuestion={handleRunOnboardingPracticeQuestion}
        onComplete={() => {
          setOnboardingOpen(false);
          updatePreferences({ onboardingCompleted: true });
          showToast('Setup complete — reopen Setup Guide anytime from the sidebar');
        }}
        onSkip={() => {
          setOnboardingOpen(false);
          updatePreferences({ onboardingDismissed: true });
        }}
      />

      {/* Risk & Competitor Drawer */}
      {selectedMeeting && (
        <RiskDrawer
          open={riskDrawerOpen}
          onClose={() => setRiskDrawerOpen(false)}
          meeting={selectedMeeting}
          battlecard={matchedBattlecard}
          onCopyText={handleCopyText}
        />
      )}

      {/* Live Browser Audio & Desktop HUD Wrapper Modal */}
      {selectedMeeting && (
        <ZoomConnectModal
          open={zoomModalOpen}
          meeting={selectedMeeting}
          apiHeaders={apiHeaders}
          audioState={audioState}
          onStartAudioCapture={startCapture}
          onStopAudioCapture={stopCapture}
          onSetMicSpeaker={setMicSpeaker}
          onUploadAudioFile={uploadAudioFile}
          onSendTurn={(speaker: SpeakerRole, speakerName: string, text: string) => {
            sendWsMessage({
              type: 'transcript:add',
              meetingId: selectedMeeting.id,
              eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              speaker,
              speakerName,
              text,
            });
          }}
          onClose={() => setZoomModalOpen(false)}
          onCopyText={handleCopyText}
          onSwitchToDesktopHud={handleEnterDesktopHud}
        />
      )}

      {/* New Live Call Modal */}
      {newMeetingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F172A]/45">
          <div className="bg-white rounded-lg border border-slate-200 w-full max-w-lg eki-drawer p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Launch Meeting Copilot Session
              </h2>
              <button
                type="button"
                onClick={() => setNewMeetingModalOpen(false)}
                aria-label="Close modal"
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateMeeting} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Account Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newAccount}
                    onChange={(e) => setNewAccount(e.target.value)}
                    placeholder="e.g. Acme Robotics"
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Deal Value (USD)
                  </label>
                  <input
                    type="number"
                    min="1000"
                    value={newDealValue}
                    onChange={(e) => setNewDealValue(e.target.value)}
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px] font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Meeting Title
                  </label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Security & Enterprise Pricing Review"
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Capture Source
                  </label>
                  <select
                    value={newPlatform}
                    onChange={(e) =>
                      setNewPlatform(e.target.value as MeetingSession['platform'])
                    }
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                  >
                    <option value="Live Mic">Browser Mic + Tab Audio (No Bot)</option>
                    <option value="Simulator">Simulated Transcript Stream</option>
                    <option value="Zoom RTMS">Zoom Webhook / RTMS Stream</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Deal Stage
                  </label>
                  <select
                    value={newStage}
                    onChange={(e) => setNewStage(e.target.value as DealStage)}
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                  >
                    <option value="Discovery">Discovery</option>
                    <option value="Technical Validation">Technical Validation</option>
                    <option value="Security Review">Security Review</option>
                    <option value="Commercial Negotiation">Commercial Negotiation</option>
                    <option value="Executive Alignment">Executive Alignment</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Primary Competitor
                  </label>
                  <select
                    value={newCompetitor}
                    onChange={(e) => setNewCompetitor(e.target.value)}
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                  >
                    {battlecards.map((b) => (
                      <option key={b.id} value={b.competitorName}>
                        {b.competitorName}
                      </option>
                    ))}
                    <option value="None / Greenfield">None / Greenfield</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prospect Stakeholders (comma-separated)
                </label>
                <input
                  type="text"
                  value={newStakeholder}
                  onChange={(e) => setNewStakeholder(e.target.value)}
                  placeholder="e.g. Jordan Lee (CTO), Dana Park (Procurement)"
                  className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                />
              </div>

              <label className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-[#F8FAFC] p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newConsentConfirmed}
                  onChange={(e) => setNewConsentConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#4F46E5]"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  Confirm participant notice and capture consent (starts session in{' '}
                  <strong className="font-semibold text-slate-900">Capture Active</strong> state; uncheck to stage in{' '}
                  <strong className="font-semibold text-slate-900">Created</strong> state until consent is confirmed).
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewMeetingModalOpen(false)}
                  className="eki-btn-secondary px-4 py-2 rounded-md text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingMeeting}
                  className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium"
                >
                  {creatingMeeting ? 'Starting...' : 'Enter Live Copilot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stealth Floating Copilot Overlay */}
      <CornerCopilotHud
        open={cornerHudOpen}
        meeting={selectedMeeting}
        battlecards={battlecards}
        analyzing={analyzing}
        quickAnswering={quickAnswering}
        audioState={audioState}
        onStartAudioCapture={startCapture}
        onStopAudioCapture={stopCapture}
        onRequestQuickAnswer={handleRequestQuickAnswer}
        onInsightAction={(insightId, action) => {
          if (!selectedMeeting) return;
          sendWsMessage({
            type: 'insight:action',
            meetingId: selectedMeeting.id,
            insightId,
            action,
          });
        }}
        onInsightFeedback={(insightId: string, rating: FeedbackRating) => {
          if (!selectedMeeting) return;
          sendWsMessage({
            type: 'insight:feedback',
            meetingId: selectedMeeting.id,
            insightId,
            rating,
          });
          showToast('Recommendation marked useful');
        }}
        onCopyText={handleCopyText}
        onOpenAudioSettings={() => setZoomModalOpen(true)}
        onClose={() => setCornerHudOpen(false)}
        density={preferences.density}
        onChangeDensity={handleChangeDensity}
      />

      {/* Non-blocking Toast */}
      {toast && (
        <div
          className={`fixed z-50 rounded-md bg-[#0F172A] text-white px-4 py-2.5 text-xs font-medium eki-popover border border-slate-700 ${
            cornerHudOpen ? 'top-4 left-1/2 -translate-x-1/2' : 'bottom-5 right-5'
          }`}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export function App() {
  const { user, authReady, idToken, signOut } = useAuth();

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-[#4F46E5]" />
          <span>Verifying Google session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginGate />;
  }

  const googleUser = {
    uid: user.uid,
    name: user.displayName || user.email?.split('@')[0] || 'Workspace User',
    email: user.email || '',
    photoURL: user.photoURL || undefined,
  };

  return (
    <AuthenticatedWorkspace
      googleUser={googleUser}
      idToken={idToken}
      onSignOut={signOut}
    />
  );
}

export default App;
