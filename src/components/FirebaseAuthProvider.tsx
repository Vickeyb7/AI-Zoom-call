import React from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  signInWithGoogle,
  signOutUser,
  syncGoogleUserProfile,
} from '../firebase';

interface FirebaseAuthContextValue {
  user: User | null;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  authErrorCode: string | null;
  idToken: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const FirebaseAuthContext = React.createContext<FirebaseAuthContextValue | null>(null);

function extractFirebaseErrorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : '';
}

function formatFirebaseAuthError(err: unknown): string {
  const code = extractFirebaseErrorCode(err);

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in popup was closed before completing. Click "Continue with Google" to try again.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the Google sign-in popup. Please allow popups for this site or open the app in a standalone tab.';
  }
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Domain "${host}" is not yet authorized in Firebase Auth. Refresh and retry, or add "${host}" under Authentication → Settings → Authorized domains in Firebase Console.`;
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error while reaching Google authentication. Check your connection and retry.';
  }
  return err instanceof Error ? err.message : 'Unable to complete Google sign-in.';
}

export const FirebaseAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = React.useState<User | null>(null);
  const [authReady, setAuthReady] = React.useState(false);
  const [signingIn, setSigningIn] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = React.useState<string | null>(null);
  const [idToken, setIdToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken();
          setIdToken(token);
        } catch {
          setIdToken(null);
        }
        try {
          await syncGoogleUserProfile(firebaseUser);
        } catch (err) {
          // Non-fatal: structured FirestoreErrorInfo already logged by handleFirestoreError
          console.warn('Profile sync warning:', err);
        }
      } else {
        setIdToken(null);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const signIn = React.useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);
    setAuthErrorCode(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthErrorCode(extractFirebaseErrorCode(err) || null);
      setAuthError(formatFirebaseAuthError(err));
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = React.useCallback(async () => {
    setAuthError(null);
    setAuthErrorCode(null);
    try {
      await signOutUser();
    } catch (err) {
      setAuthErrorCode(extractFirebaseErrorCode(err) || null);
      setAuthError(formatFirebaseAuthError(err));
    }
  }, []);

  const clearError = React.useCallback(() => {
    setAuthError(null);
    setAuthErrorCode(null);
  }, []);

  const value = React.useMemo<FirebaseAuthContextValue>(
    () => ({
      user,
      authReady,
      signingIn,
      authError,
      authErrorCode,
      idToken,
      signIn,
      signOut,
      clearError,
    }),
    [user, authReady, signingIn, authError, authErrorCode, idToken, signIn, signOut, clearError],
  );

  return (
    <FirebaseAuthContext.Provider value={value}>
      {children}
    </FirebaseAuthContext.Provider>
  );
};

export function useAuth(): FirebaseAuthContextValue {
  const ctx = React.useContext(FirebaseAuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside FirebaseAuthProvider');
  }
  return ctx;
}
