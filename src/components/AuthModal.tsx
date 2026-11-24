import { FormEvent, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  User,
  X,
} from 'lucide-react';
import { auth } from '../firebase';
import { useFirebase } from '../context/FirebaseProvider';
import { usePreferences } from '../context/PreferencesProvider';
import { BrandLogo } from './BrandLogo';

function formatAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';

  switch (code) {
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not yet enabled in Firebase Console (Authentication → Sign-in method → Email/Password). You can enable it there or use Google Sign-In below.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in popup was closed before completing. Please try again.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password. Please check your credentials and try again.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Switch to Sign In instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment before trying again.';
    default:
      return error instanceof Error ? error.message : 'Authentication failed. Please try again.';
  }
}

export function AuthModal() {
  const {
    authModalMode,
    openAuthModal,
    closeAuthModal,
    signInWithGoogle,
    resendVerificationEmail,
    refreshUserVerification,
  } = useFirebase();
  const { t } = usePreferences();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
    setInfoMsg(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setPendingVerificationEmail(null);
  }, [authModalMode]);

  if (!authModalMode) return null;

  const isRegister = authModalMode === 'register';

  const handleGoogleClick = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg('Enter your email address above first, then click "Forgot password?".');
      return;
    }

    setIsResettingPassword(true);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setInfoMsg(`Password reset email sent to ${trimmedEmail}. Check your inbox.`);
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleCheckVerification = async () => {
    setErrorMsg(null);
    setIsCheckingVerification(true);
    try {
      const verified = await refreshUserVerification();
      if (verified) {
        closeAuthModal();
      } else {
        setErrorMsg(
          'Your email is not verified yet. Please click the verification link in your inbox, then try again.'
        );
      }
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setIsCheckingVerification(false);
    }
  };

  const handleResendVerification = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await resendVerificationEmail();
      setInfoMsg('Verification email resent! Please check your inbox and spam folder.');
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    }
  };

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg('Please enter your email address.');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    if (isRegister) {
      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match. Please re-enter them.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (isRegister) {
        const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        if (displayName.trim()) {
          await updateProfile(cred.user, { displayName: displayName.trim() });
        }
        await sendEmailVerification(cred.user);
        setPendingVerificationEmail(trimmedEmail);
        setInfoMsg(
          `Verification link sent to ${trimmedEmail}. Verify your email to enable cloud sheet uploads.`
        );
      } else {
        const cred = await signInWithEmailAndPassword(auth, trimmedEmail, password);
        if (!cred.user.emailVerified) {
          setPendingVerificationEmail(trimmedEmail);
          setInfoMsg(
            'You are signed in, but your email is not verified yet. Verify it to save private sheets to the cloud.'
          );
        } else {
          closeAuthModal();
        }
      }
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-black/70 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden my-auto">
        <button
          type="button"
          onClick={closeAuthModal}
          aria-label="Close authentication dialog"
          className="absolute top-4 right-4 p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Branded Logo Header */}
        <div className="px-6 pt-6 pb-4 text-center border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
          <BrandLogo size="lg" className="mx-auto shadow-sm mb-3" />
          <h2 id="auth-modal-title" className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
            {pendingVerificationEmail
              ? t('auth.verifyTitle')
              : isRegister
              ? t('auth.registerTitle')
              : t('auth.signinTitle')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {pendingVerificationEmail
              ? t('auth.verifySubtitle')
              : t('auth.defaultSubtitle')}
          </p>
        </div>

        {pendingVerificationEmail ? (
          <div className="p-6 space-y-4">
            {infoMsg && (
              <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-medium text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>{infoMsg}</span>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg text-xs font-medium text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="button"
              disabled={isCheckingVerification}
              onClick={() => void handleCheckVerification()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {isCheckingVerification ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{t('auth.verifiedContinue')}</span>
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => void handleResendVerification()}
                className="text-xs font-semibold text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 underline-offset-2 hover:underline"
              >
                {t('auth.resendVerification')}
              </button>
              <button
                type="button"
                onClick={closeAuthModal}
                className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              >
                {t('auth.continueForNow')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Mode Switcher Tabs */}
            <div className="px-6 pt-5">
              <div
                className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
                role="tablist"
                aria-label="Authentication mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isRegister}
                  onClick={() => openAuthModal('signin')}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    !isRegister
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t('nav.signIn')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isRegister}
                  onClick={() => openAuthModal('register')}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    isRegister
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t('nav.register')}
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Email & Password Form */}
              <form onSubmit={(e) => void handleEmailSubmit(e)} className="space-y-3.5">
                {isRegister && (
                  <div>
                    <label
                      htmlFor="auth-display-name"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      {t('auth.displayName')}
                    </label>
                    <div className="relative">
                      <User
                        className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <input
                        id="auth-display-name"
                        type="text"
                        autoComplete="name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t('auth.displayNamePlaceholder')}
                        disabled={isSubmitting || isGoogleLoading}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    {t('auth.email')}
                  </label>
                  <div className="relative">
                    <Mail
                      className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('auth.emailPlaceholder')}
                      disabled={isSubmitting || isGoogleLoading}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      {t('auth.password')}
                    </label>
                    {!isRegister && (
                      <button
                        type="button"
                        disabled={isResettingPassword || isSubmitting}
                        onClick={() => void handleForgotPassword()}
                        className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 hover:underline disabled:opacity-50"
                      >
                        {isResettingPassword ? t('auth.sending') : t('auth.forgotPassword')}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock
                      className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete={isRegister ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isRegister ? t('auth.passwordPlaceholder') : '••••••••'}
                      disabled={isSubmitting || isGoogleLoading}
                      className="w-full pl-9 pr-10 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {isRegister && (
                  <div>
                    <label
                      htmlFor="auth-confirm-password"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      {t('auth.confirmPassword')}
                    </label>
                    <div className="relative">
                      <Lock
                        className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <input
                        id="auth-confirm-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t('auth.confirmPlaceholder')}
                        disabled={isSubmitting || isGoogleLoading}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                  </div>
                )}

                {errorMsg && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg text-xs font-medium text-red-700 dark:text-red-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {infoMsg && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-medium text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                    <CheckCircle2
                      className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                    <span>{infoMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || isGoogleLoading}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 disabled:opacity-50 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  <span>{isRegister ? t('auth.createAccount') : t('nav.signIn')}</span>
                </button>
              </form>

              {/* Divider */}
              <div className="relative flex items-center">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-700" />
                <span className="shrink-0 px-3 text-xs font-medium text-slate-400 dark:text-slate-500">
                  {t('auth.or')}
                </span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-700" />
              </div>

              {/* Google SSO */}
              <button
                type="button"
                disabled={isGoogleLoading || isSubmitting}
                onClick={() => void handleGoogleClick()}
                className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-400 dark:hover:border-slate-600 disabled:opacity-50 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                {isGoogleLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-sky-600 dark:text-sky-400" aria-hidden="true" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                    />
                  </svg>
                )}
                <span>{isRegister ? t('auth.continueGoogle') : t('auth.signInGoogle')}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
