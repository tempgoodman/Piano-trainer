import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  sendEmailVerification,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { subscribeToUserHotkeys } from '../services/firestoreHotkeys';
import { subscribeToUserScores } from '../services/firestoreScores';
import { subscribeToUserPracticeStats } from '../services/firestoreStats';
import { usePracticeStore } from '../store/usePracticeStore';
import { DEFAULT_USER_HOTKEYS, isSameHotkeysConfig } from '../types/hotkeys';

export type AuthModalMode = 'signin' | 'register' | null;

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  isLoadingScores: boolean;
  authModalMode: AuthModalMode;
  openAuthModal: (mode: Exclude<AuthModalMode, null>) => void;
  closeAuthModal: () => void;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshUserVerification: () => Promise<boolean>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [, setUserVersion] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [isLoadingScores, setIsLoadingScores] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>(null);
  const [listenerError, setListenerError] = useState<Error | null>(null);

  const setUserScores = usePracticeStore((s) => s.setUserScores);
  const setHotkeys = usePracticeStore((s) => s.setHotkeys);
  const resetHotkeysToDefault = usePracticeStore((s) => s.resetHotkeysToDefault);
  const setPracticeStats = usePracticeStore((s) => s.setPracticeStats);
  const clearPracticeStats = usePracticeStore((s) => s.clearPracticeStats);

  // Surface critical Firestore listener errors to ErrorBoundary
  if (listenerError) {
    throw listenerError;
  }

  useEffect(() => {
    let unsubscribeScores: (() => void) | null = null;
    let unsubscribeHotkeys: (() => void) | null = null;
    let unsubscribeStats: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (unsubscribeScores) {
        unsubscribeScores();
        unsubscribeScores = null;
      }
      if (unsubscribeHotkeys) {
        unsubscribeHotkeys();
        unsubscribeHotkeys = null;
      }
      if (unsubscribeStats) {
        unsubscribeStats();
        unsubscribeStats = null;
      }

      setUser(firebaseUser);
      setAuthReady(true);

      if (firebaseUser) {
        setIsLoadingScores(true);
        unsubscribeScores = subscribeToUserScores(
          firebaseUser.uid,
          (cloudScores) => {
            setUserScores(cloudScores);
            setIsLoadingScores(false);
          },
          (err) => {
            setIsLoadingScores(false);
            setListenerError(err);
          }
        );

        unsubscribeHotkeys = subscribeToUserHotkeys(
          firebaseUser.uid,
          (cloudHotkeys) => {
            if (cloudHotkeys) {
              setHotkeys(cloudHotkeys, !isSameHotkeysConfig(cloudHotkeys, DEFAULT_USER_HOTKEYS));
            } else {
              resetHotkeysToDefault();
            }
          },
          (err) => {
            setListenerError(err);
          }
        );

        unsubscribeStats = subscribeToUserPracticeStats(
          firebaseUser.uid,
          (records) => {
            setPracticeStats(records);
          },
          (err) => {
            setListenerError(err);
          }
        );
      } else {
        setUserScores([]);
        resetHotkeysToDefault();
        clearPracticeStats();
        setIsLoadingScores(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeScores) {
        unsubscribeScores();
      }
      if (unsubscribeHotkeys) {
        unsubscribeHotkeys();
      }
      if (unsubscribeStats) {
        unsubscribeStats();
      }
    };
  }, [clearPracticeStats, resetHotkeysToDefault, setHotkeys, setPracticeStats, setUserScores]);

  const openAuthModal = useCallback((mode: Exclude<AuthModalMode, null>) => {
    setAuthModalMode(mode);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalMode(null);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
    setAuthModalMode(null);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('You must be signed in to resend a verification email.');
    }
    await sendEmailVerification(auth.currentUser);
  }, []);

  const refreshUserVerification = useCallback(async (): Promise<boolean> => {
    const current = auth.currentUser;
    if (!current) return false;
    await current.reload();
    await current.getIdToken(true);
    setUser(auth.currentUser);
    setUserVersion((v) => v + 1);
    return Boolean(auth.currentUser?.emailVerified);
  }, []);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        isLoadingScores,
        authModalMode,
        openAuthModal,
        closeAuthModal,
        signInWithGoogle,
        signOutUser,
        resendVerificationEmail,
        refreshUserVerification,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return ctx;
}
