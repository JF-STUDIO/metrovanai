import { useRef } from 'react';

type AuthMode = 'signin' | 'signup' | 'reset-request' | 'reset-confirm' | 'verify-email';

interface AuthFormState {
  email: string;
  name: string;
  password: string;
  confirmPassword: string;
}

interface AuthModalCopy {
  authUseGoogle: string;
  authGoogleComingSoon: string;
  authUseEmail: string;
  authModeSignin: string;
  authModeSignup: string;
  authName: string;
  authEmail: string;
  authPassword: string;
  authNewPassword: string;
  authPasswordPlaceholder: string;
  authNewPasswordPlaceholder: string;
  authForgotPassword: string;
  authConfirmPassword: string;
  authConfirmPasswordPlaceholder: string;
  authBackToLogin: string;
  authNoAccount: string;
  authHasAccount: string;
}

interface AuthModalProps {
  copy: AuthModalCopy;
  authMode: AuthMode;
  authBusy: boolean;
  auth: AuthFormState;
  authTitle: string;
  authSubtitle: string;
  authMessage: string;
  authSubmitLabel: string;
  googleAuthEnabled: boolean | null;
  isAuthLinkMode: boolean;
  isEmailVerifyMode: boolean;
  onClose: () => void;
  onGoogleAuth: () => void;
  onSelectMode: (mode: 'signin' | 'signup') => void;
  onAuthChange: (patch: Partial<AuthFormState>) => void;
  onForgotPassword: () => void;
  onToggleMode: () => void;
  onSubmit: () => void;
}

export function AuthModal({
  copy,
  authMode,
  authBusy,
  auth,
  authTitle,
  authSubtitle,
  authMessage,
  authSubmitLabel,
  googleAuthEnabled,
  isAuthLinkMode,
  isEmailVerifyMode,
  onClose,
  onGoogleAuth,
  onSelectMode,
  onAuthChange,
  onForgotPassword,
  onToggleMode,
  onSubmit
}: AuthModalProps) {
  const startedOnBackdropRef = useRef(false);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        startedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (startedOnBackdropRef.current && event.target === event.currentTarget) {
          onClose();
        }
        startedOnBackdropRef.current = false;
      }}
    >
      <div
        className="modal-card auth-card"
        onMouseDown={(event) => {
          event.stopPropagation();
          startedOnBackdropRef.current = false;
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="auth-chip">Metrovan AI Access</div>
        <div className="modal-head">
          <div className="auth-copy">
            <strong>{authTitle}</strong>
            <span>{authSubtitle}</span>
          </div>
          <button className="close-button" type="button" onClick={onClose}>
            ×
          </button>
        </div>
        {!isAuthLinkMode && (
          <div className="auth-provider-stack">
            <button
              className="provider-button"
              type="button"
              onClick={onGoogleAuth}
              disabled={authBusy || googleAuthEnabled === false}
            >
              <span className="provider-icon">G</span>
              <span>{copy.authUseGoogle}</span>
            </button>
            {googleAuthEnabled === false && <div className="provider-note">{copy.authGoogleComingSoon}</div>}
            <div className="auth-divider">
              <span>{copy.authUseEmail}</span>
            </div>
          </div>
        )}
        {!isAuthLinkMode && (
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              className={`auth-tab${authMode === 'signin' ? ' active' : ''}`}
              type="button"
              onClick={() => onSelectMode('signin')}
              disabled={authBusy}
            >
              {copy.authModeSignin}
            </button>
            <button
              className={`auth-tab${authMode === 'signup' ? ' active' : ''}`}
              type="button"
              onClick={() => onSelectMode('signup')}
              disabled={authBusy}
            >
              {copy.authModeSignup}
            </button>
          </div>
        )}
        {authMessage && <div className="auth-feedback">{authMessage}</div>}
        <div className="form-grid">
          {authMode === 'signup' && (
            <label>
              <span>{copy.authName}</span>
              <input
                disabled={authBusy}
                value={auth.name}
                onChange={(event) => onAuthChange({ name: event.target.value })}
                placeholder="Your name"
              />
            </label>
          )}
          {authMode !== 'reset-confirm' && authMode !== 'verify-email' && (
            <label>
              <span>{copy.authEmail}</span>
              <input
                disabled={authBusy}
                type="email"
                autoComplete={authMode === 'signin' ? 'username' : 'email'}
                value={auth.email}
                onChange={(event) => onAuthChange({ email: event.target.value })}
                placeholder="name@email.com"
              />
            </label>
          )}
          {authMode !== 'reset-request' && authMode !== 'verify-email' && (
            <label>
              <span>{authMode === 'reset-confirm' ? copy.authNewPassword : copy.authPassword}</span>
              <input
                disabled={authBusy}
                type="password"
                autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                value={auth.password}
                onChange={(event) => onAuthChange({ password: event.target.value })}
                placeholder={authMode === 'reset-confirm' ? copy.authNewPasswordPlaceholder : copy.authPasswordPlaceholder}
              />
            </label>
          )}
          {authMode === 'signin' && (
            <div className="auth-inline-actions">
              <button className="text-link auth-inline-link" type="button" onClick={onForgotPassword} disabled={authBusy}>
                {copy.authForgotPassword}
              </button>
            </div>
          )}
          {(authMode === 'signup' || authMode === 'reset-confirm') && (
            <label>
              <span>{copy.authConfirmPassword}</span>
              <input
                disabled={authBusy}
                type="password"
                autoComplete="new-password"
                value={auth.confirmPassword}
                onChange={(event) => onAuthChange({ confirmPassword: event.target.value })}
                placeholder={copy.authConfirmPasswordPlaceholder}
              />
            </label>
          )}
        </div>
        <div className="modal-actions auth-actions">
          <button className="ghost-button" type="button" onClick={onToggleMode} disabled={authBusy}>
            {isAuthLinkMode ? copy.authBackToLogin : authMode === 'signin' ? copy.authNoAccount : copy.authHasAccount}
          </button>
          {!isEmailVerifyMode && (
            <button className="solid-button auth-submit" type="button" onClick={onSubmit} disabled={authBusy}>
              {authSubmitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
