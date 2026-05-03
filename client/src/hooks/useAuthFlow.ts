import { startTransition, useEffect, useRef, useState } from 'react';
import {
  confirmEmailVerification,
  confirmPasswordReset,
  fetchAuthProviders,
  getApiRoot,
  loginWithEmail,
  registerWithEmail,
  requestPasswordReset
} from '../api';
import {
  clearAuthTokenQuery,
  getAuthErrorMessage,
  getAuthFeedbackMessage,
  getEmailVerificationTokenFromQuery,
  getInitialAuthMode,
  getPasswordResetTokenFromQuery,
  getPathForRoute,
  isStrongPasswordInput,
  shouldOpenAuthFromQuery,
  type AppRoute,
  type AuthMode,
  type SessionState
} from '../app-utils';
import type { UiLocale } from '../app-copy';

interface UseAuthFlowInput {
  copy: any;
  isDemoMode: boolean;
  locale: UiLocale;
  navigateToRoute: (route: AppRoute) => void;
  setActiveRoute: (route: AppRoute) => void;
  setLocale: (locale: UiLocale) => void;
  setMessage: (message: string) => void;
  setSession: (session: SessionState | null) => void;
}

const emptyAuth = { email: '', name: '', password: '', confirmPassword: '', verificationCode: '' };

export function useAuthFlow({
  copy,
  isDemoMode,
  locale,
  navigateToRoute,
  setActiveRoute,
  setLocale,
  setMessage,
  setSession
}: UseAuthFlowInput) {
  const [authOpen, setAuthOpen] = useState(() => shouldOpenAuthFromQuery());
  const [authMode, setAuthMode] = useState<AuthMode>(() => getInitialAuthMode());
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState<boolean | null>(null);
  const [authMessage, setAuthMessage] = useState('');
  const [auth, setAuth] = useState(emptyAuth);
  const [authBusy, setAuthBusy] = useState(false);
  const emailVerificationHandledRef = useRef(false);

  const authTitle =
    authMode === 'signin'
      ? copy.authTitleSignin
      : authMode === 'signup'
        ? copy.authTitleSignup
        : authMode === 'reset-request'
          ? copy.authTitleResetRequest
          : authMode === 'reset-confirm'
            ? copy.authTitleResetConfirm
            : copy.authTitleVerifyEmail;
  const authSubtitle =
    authMode === 'signin'
      ? copy.authSubtitleSignin
      : authMode === 'signup'
        ? copy.authSubtitleSignup
        : authMode === 'reset-request'
          ? copy.authSubtitleResetRequest
          : authMode === 'reset-confirm'
            ? copy.authSubtitleResetConfirm
            : copy.authSubtitleVerifyEmail;
  const isPasswordResetMode = authMode === 'reset-request' || authMode === 'reset-confirm';
  const isEmailVerifyMode = authMode === 'verify-email';
  const isAuthLinkMode = isPasswordResetMode || isEmailVerifyMode;
  const authSubmitLabel = authBusy
    ? copy.authWorking
    : authMode === 'signin'
      ? copy.authModeSignin
      : authMode === 'signup'
        ? copy.authModeSignup
        : authMode === 'reset-request'
          ? copy.authModeResetRequest
          : authMode === 'reset-confirm'
            ? copy.authModeResetConfirm
            : copy.authModeVerifyEmail;

  useEffect(() => {
    if (isDemoMode) {
      return;
    }

    let cancelled = false;
    void fetchAuthProviders()
      .then((response) => {
        if (cancelled) return;
        setGoogleAuthEnabled(response.google.enabled);
      })
      .catch(() => {
        if (cancelled) return;
        setGoogleAuthEnabled(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isDemoMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('authError');
    const authProvider = params.get('authProvider');
    if (!authError && !authProvider) {
      return;
    }

    startTransition(() => {
      if (authError) {
        setAuthMessage(getAuthFeedbackMessage(authError, locale));
        setMessage('');
        setAuthOpen(true);
        setAuthMode('signin');
      } else if (authProvider === 'google') {
        setMessage(copy.googleSuccess);
      }
    });

    params.delete('authError');
    params.delete('authProvider');
    params.delete('auth');
    const nextQuery = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
  }, [copy.googleSuccess, locale, setMessage]);

  useEffect(() => {
    if (isDemoMode || !authOpen || authMode !== 'verify-email' || emailVerificationHandledRef.current) {
      return;
    }

    const queryEmail = new URLSearchParams(window.location.search).get('email')?.trim() ?? '';
    if (queryEmail) {
      setAuth((current) => ({ ...current, email: current.email || queryEmail }));
    }

    const verificationToken = getEmailVerificationTokenFromQuery();
    if (!verificationToken) {
      return;
    }

    emailVerificationHandledRef.current = true;
    const timer = window.setTimeout(() => {
      setAuthBusy(true);
      setAuthMessage(copy.authSubtitleVerifyEmail);
      void confirmEmailVerification({ token: verificationToken })
        .then((response) => {
          clearAuthTokenQuery();
          setSession(response.session.user);
          setLocale(response.session.user.locale);
          setAuthOpen(false);
          setAuth(emptyAuth);
          setAuthMessage('');
          const nextPath = getPathForRoute('studio');
          const nextUrl = `${nextPath}${window.location.hash}`;
          if (window.location.pathname !== nextPath) {
            window.history.pushState({}, '', nextUrl);
          }
          setActiveRoute('studio');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setMessage(copy.authEmailVerifiedSuccess);
        })
        .catch((error) => {
          setAuthMessage(getAuthErrorMessage(error, 'verify-email', locale));
          setMessage('');
        })
        .finally(() => {
          setAuthBusy(false);
        });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [authMode, authOpen, copy.authEmailVerifiedSuccess, copy.authSubtitleVerifyEmail, isDemoMode, locale, setActiveRoute, setLocale, setMessage, setSession]);

  function openAuth(nextMode: AuthMode) {
    setAuthMode(nextMode);
    setAuthOpen(true);
    setAuthMessage('');
    setMessage('');
  }

  function closeAuth() {
    if (authMode === 'reset-confirm' || authMode === 'verify-email') {
      clearAuthTokenQuery();
    }
    setAuthOpen(false);
    setAuth(emptyAuth);
    setAuthMessage('');
  }

  function handleGoogleAuth() {
    if (googleAuthEnabled === false) {
      setAuthMessage(copy.googleConfiguredMissing);
      setMessage('');
      setAuthOpen(true);
      setAuthMode('signin');
      return;
    }
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    window.location.assign(`${getApiRoot()}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`);
  }

  function handleForgotPassword() {
    setAuthMode('reset-request');
    setAuth((current) => ({
      ...current,
      password: '',
      confirmPassword: ''
    }));
    setAuthMessage('');
    setMessage('');
  }

  async function submitAuth() {
    const email = auth.email.trim();

    if (authMode === 'reset-request') {
      if (!email) {
        setAuthMessage(copy.authMissingEmail);
        setMessage('');
        return;
      }

      setAuthBusy(true);
      setAuthMessage('');
      try {
        await requestPasswordReset({ email });
        setAuthMessage(copy.authResetEmailSent);
        setMessage('');
      } catch (error) {
        setAuthMessage(getAuthErrorMessage(error, authMode, locale));
        setMessage('');
      } finally {
        setAuthBusy(false);
      }
      return;
    }

    if (authMode === 'reset-confirm') {
      const resetToken = getPasswordResetTokenFromQuery();
      if (!resetToken) {
        setAuthMessage(copy.authResetTokenMissing);
        setMessage('');
        return;
      }
      if (!isStrongPasswordInput(auth.password)) {
        setAuthMessage(copy.authPasswordTooShort);
        setMessage('');
        return;
      }
      if (auth.password !== auth.confirmPassword) {
        setAuthMessage(copy.authPasswordMismatch);
        setMessage('');
        return;
      }

      setAuthBusy(true);
      setAuthMessage('');
      try {
        await confirmPasswordReset({
          token: resetToken,
          password: auth.password
        });
        clearAuthTokenQuery();
        setAuthMode('signin');
        setAuth((current) => ({
          ...current,
          password: '',
          confirmPassword: ''
        }));
        setAuthMessage(copy.authResetPasswordSuccess);
        setMessage('');
      } catch (error) {
        setAuthMessage(getAuthErrorMessage(error, authMode, locale));
        setMessage('');
      } finally {
        setAuthBusy(false);
      }
      return;
    }

    if (authMode === 'verify-email') {
      const verificationCode = auth.verificationCode.trim();
      if (!email || !/^\d{6}$/.test(verificationCode)) {
        setAuthMessage(locale === 'zh' ? '请输入邮箱和 6 位验证码。' : 'Enter your email and 6-digit code.');
        setMessage('');
        return;
      }

      setAuthBusy(true);
      setAuthMessage('');
      try {
        const response = await confirmEmailVerification({
          email,
          code: verificationCode
        });
        clearAuthTokenQuery();
        setSession(response.session.user);
        setLocale(response.session.user.locale);
        setAuthOpen(false);
        setAuth(emptyAuth);
        setAuthMessage('');
        navigateToRoute('studio');
        setMessage(copy.authEmailVerifiedSuccess);
      } catch (error) {
        setAuthMessage(getAuthErrorMessage(error, authMode, locale));
        setMessage('');
      } finally {
        setAuthBusy(false);
      }
      return;
    }

    if (!email || !auth.password.trim()) {
      const nextMessage = copy.authMissingFields;
      setAuthMessage(nextMessage);
      setMessage('');
      return;
    }
    if (authMode === 'signup' && auth.password !== auth.confirmPassword) {
      const nextMessage = copy.authPasswordMismatch;
      setAuthMessage(nextMessage);
      setMessage('');
      return;
    }
    if (authMode === 'signup' && !isStrongPasswordInput(auth.password)) {
      setAuthMessage(copy.authPasswordTooShort);
      setMessage('');
      return;
    }

    setAuthBusy(true);
    setAuthMessage('');
    try {
      if (authMode === 'signin') {
        const response = await loginWithEmail({
          email,
          password: auth.password
        });
        setSession(response.session.user);
        setLocale(response.session.user.locale);
        closeAuth();
        navigateToRoute('studio');
        setMessage(copy.signInSuccess);
        return;
      }

      const response = await registerWithEmail({
        email,
        displayName: auth.name.trim() || undefined,
        password: auth.password
      });
      if (response.verificationRequired) {
        setAuthMode('verify-email');
        setAuth((current) => ({
          ...current,
          password: '',
          confirmPassword: '',
          verificationCode: ''
        }));
        setAuthMessage(copy.authVerificationEmailSent);
        setMessage('');
        return;
      }

      if (response.session) {
        setSession(response.session.user);
        setLocale(response.session.user.locale);
        closeAuth();
        navigateToRoute('studio');
        setMessage(copy.signUpSuccess);
      }
    } catch (error) {
      const nextMessage = getAuthErrorMessage(error, authMode, locale);
      setAuthMessage(nextMessage);
      setMessage('');
      if (authMode === 'signup' && nextMessage === copy.authEmailExists) {
        setAuthMode('signin');
        setAuth((current) => ({
          ...current,
          password: '',
          confirmPassword: ''
        }));
      }
      if (authMode === 'signin' && nextMessage === copy.authEmailNotVerified) {
        setAuthMode('verify-email');
        setAuth((current) => ({
          ...current,
          email,
          password: '',
          confirmPassword: '',
          verificationCode: ''
        }));
        setAuthMessage(copy.authVerificationEmailSent);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  function toggleAuthMode() {
    if (authMode === 'reset-confirm' || authMode === 'verify-email') {
      clearAuthTokenQuery();
    }
    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
    setAuthMessage('');
  }

  return {
    authDialogProps: {
      copy,
      open: authOpen,
      authMode,
      authBusy,
      auth,
      authTitle,
      authSubtitle,
      authMessage,
      authSubmitLabel,
      googleAuthEnabled,
      isAuthLinkMode,
      onClose: closeAuth,
      onGoogleAuth: handleGoogleAuth,
      onSelectMode: (mode: 'signin' | 'signup') => {
        setAuthMode(mode);
        setAuthMessage('');
      },
      onAuthChange: (patch: any) => setAuth((current) => ({ ...current, ...patch })),
      onForgotPassword: handleForgotPassword,
      onToggleMode: toggleAuthMode,
      onSubmit: submitAuth
    },
    openAuth,
    setAuthMessage
  };
}
