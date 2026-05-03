import { AuthModal } from './AuthModal';

type AuthMode = 'signin' | 'signup' | 'reset-request' | 'reset-confirm' | 'verify-email';

interface AppAuthDialogProps {
  auth: any;
  authBusy: boolean;
  authMessage: string;
  authMode: AuthMode;
  authSubmitLabel: string;
  authSubtitle: string;
  authTitle: string;
  copy: any;
  googleAuthEnabled: boolean | null;
  isAuthLinkMode: boolean;
  open: boolean;
  hasSession: boolean;
  onAuthChange: (patch: any) => void;
  onClose: () => void;
  onForgotPassword: () => void;
  onGoogleAuth: () => void;
  onSelectMode: (mode: 'signin' | 'signup') => void;
  onSubmit: () => void;
  onToggleMode: () => void;
}

export function AppAuthDialog({
  auth,
  authBusy,
  authMessage,
  authMode,
  authSubmitLabel,
  authSubtitle,
  authTitle,
  copy,
  googleAuthEnabled,
  hasSession,
  isAuthLinkMode,
  open,
  onAuthChange,
  onClose,
  onForgotPassword,
  onGoogleAuth,
  onSelectMode,
  onSubmit,
  onToggleMode
}: AppAuthDialogProps) {
  if (!open || hasSession) {
    return null;
  }

  return (
    <AuthModal
      copy={copy}
      authMode={authMode}
      authBusy={authBusy}
      auth={auth}
      authTitle={authTitle}
      authSubtitle={authSubtitle}
      authMessage={authMessage}
      authSubmitLabel={authSubmitLabel}
      googleAuthEnabled={googleAuthEnabled}
      isAuthLinkMode={isAuthLinkMode}
      onClose={onClose}
      onGoogleAuth={onGoogleAuth}
      onSelectMode={onSelectMode}
      onAuthChange={onAuthChange}
      onForgotPassword={onForgotPassword}
      onToggleMode={onToggleMode}
      onSubmit={onSubmit}
    />
  );
}
