import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate Firestore connection on startup
async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

// Validation constants synchronized verbatim with firebase-blueprint.json
const UID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_UID_LEN = 128;
const MAX_EMAIL_LEN = 254;
const MAX_DISPLAY_NAME_LEN = 120;
const MAX_PHOTO_URL_LEN = 500;

export async function syncGoogleUserProfile(user: User): Promise<void> {
  if (!user.uid || user.uid.length > MAX_UID_LEN || !UID_PATTERN.test(user.uid)) {
    return;
  }
  const email = (user.email || '').trim().slice(0, MAX_EMAIL_LEN);
  if (!email || !user.emailVerified) {
    return;
  }

  const displayName = (
    user.displayName?.trim() ||
    email.split('@')[0] ||
    'Workspace User'
  ).slice(0, MAX_DISPLAY_NAME_LEN);
  const photoURL = (user.photoURL || '').trim().slice(0, MAX_PHOTO_URL_LEN);

  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);

  let exists = false;
  try {
    const snap = await getDoc(ref);
    exists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!exists) {
    const createPayload: Record<string, unknown> = {
      uid: user.uid,
      email,
      displayName,
      role: 'member',
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    };
    if (photoURL) {
      createPayload.photoURL = photoURL;
    }
    try {
      await setDoc(ref, createPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    const updatePayload: Record<string, unknown> = {
      displayName,
      lastLoginAt: serverTimestamp(),
    };
    if (photoURL) {
      updatePayload.photoURL = photoURL;
    }
    try {
      await updateDoc(ref, updatePayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
