import React from 'react';
import {
  Activity,
  ExternalLink,
  Loader2,
  Lock,
  Radio,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAuth } from './FirebaseAuthProvider';
import firebaseConfig from '../../firebase-applet-config.json';

const GoogleMark: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export const LoginGate: React.FC = () => {
  const { signIn, signingIn, authError, authErrorCode } = useAuth();
  const isEmbeddedIframe = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      {/* Clean Single-Row Top Bar */}
      <header className="h-16 px-6 lg:px-10 bg-white border-b border-slate-200 flex items-center justify-between gap-8 shrink-0">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="w-8 h-8 rounded-md bg-[#4F46E5] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-display text-[16px] font-bold tracking-tight text-slate-900">
            AI Sales Strategist
          </span>
        </div>

        <div className="text-xs text-slate-500 whitespace-nowrap shrink-0">
          Google Single Sign-On Required
        </div>
      </header>

      {/* Main Split Layout */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[1040px] grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Editorial Context */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#4F46E5]">
                Enterprise Sales Intelligence Workspace
              </p>
              <h1
                className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-[1.15]"
                style={{ textWrap: 'balance' }}
              >
                Real-time call copilot, battlecards, and stakeholder history
              </h1>
              <p className="text-[15px] text-slate-600 leading-relaxed max-w-xl">
                Sign in with your Google account to access live meeting guidance, D3 sentiment &amp; objection timelines, verified competitive playbooks, and tenant-scoped deal archives.
              </p>
            </div>

            <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Radio className="w-3.5 h-3.5 text-[#4F46E5] shrink-0" />
                  Live Call Copilot
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Private dual-channel audio listening and grounded objection responses in real time.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Activity className="w-3.5 h-3.5 text-[#4F46E5] shrink-0" />
                  Sentiment Timeline
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Interactive D3 trajectory pinpointing sentiment drops, recoveries, and competitor mentions.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Users className="w-3.5 h-3.5 text-[#4F46E5] shrink-0" />
                  Stakeholder Archive
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Role profiles and cross-meeting interaction history automatically surfaced per deal.
                </p>
              </div>
            </div>
          </div>

          {/* Right Single-Elevation Sign-In Card */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-xl border border-slate-200 p-7 space-y-6 shadow-xs">
              <div className="space-y-1.5">
                <h2 className="font-display text-xl font-semibold text-slate-900">
                  Sign in to continue
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Platform access is protected with Google authentication. Use your Google workspace or personal Google account.
                </p>
              </div>

              {authError && (
                <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] px-3.5 py-2.5 text-xs text-[#9F1239] space-y-2">
                  <p className="leading-relaxed">{authError}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    {authErrorCode === 'auth/unauthorized-domain' && (
                      <a
                        href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold underline hover:text-rose-900"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open Firebase Auth Domains
                      </a>
                    )}
                    {isEmbeddedIframe && typeof window !== 'undefined' && (
                      <a
                        href={window.location.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold underline hover:text-rose-900"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open in standalone browser tab
                      </a>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={signingIn}
                onClick={() => void signIn()}
                className="w-full h-11 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 text-sm font-semibold transition-colors flex items-center justify-center gap-3 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] focus-visible:ring-offset-2"
              >
                {signingIn ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#4F46E5]" />
                    <span>Signing in with Google...</span>
                  </>
                ) : (
                  <>
                    <GoogleMark />
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              <div className="pt-4 border-t border-slate-100 space-y-2 text-[11px] text-slate-500">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Verified Google identity synced to encrypted user profile</span>
                </div>
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Strict tenant isolation across meetings, playbooks, and RAG docs</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
