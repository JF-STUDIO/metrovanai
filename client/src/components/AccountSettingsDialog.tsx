import type { Dispatch, SetStateAction } from 'react';
import type { UiLocale } from '../app-copy';

interface AccountSettingsDialogCopy {
  authWorking: string;
  cancel: string;
  chinese: string;
  close: string;
  english: string;
  save: string;
  settingsDisplayName: string;
  settingsEmail: string;
  settingsEmailHint: string;
  settingsHint: string;
  settingsLanguage: string;
  settingsTitle: string;
}

interface AccountSettingsDraft {
  displayName: string;
  locale: UiLocale;
}

interface AccountSettingsSession {
  email: string;
}

interface AccountSettingsDialogProps {
  busy: boolean;
  copy: AccountSettingsDialogCopy;
  draft: AccountSettingsDraft;
  message: string;
  session: AccountSettingsSession;
  setDraft: Dispatch<SetStateAction<AccountSettingsDraft>>;
  onClose: () => void;
  onSave: () => void;
}

export function AccountSettingsDialog({
  busy,
  copy,
  draft,
  message,
  session,
  setDraft,
  onClose,
  onSave
}: AccountSettingsDialogProps) {
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-card settings-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <strong>{copy.settingsTitle}</strong>
            <span className="muted">{copy.settingsHint}</span>
          </div>
          <button className="close-button" type="button" onClick={onClose} disabled={busy} aria-label={copy.close}>
            ×
          </button>
        </div>

        {message && <div className="auth-feedback settings-feedback">{message}</div>}

        <div className="form-grid">
          <label>
            <span>{copy.settingsDisplayName}</span>
            <input
              value={draft.displayName}
              onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
              disabled={busy}
            />
          </label>

          <label>
            <span>{copy.settingsEmail}</span>
            <input value={session.email} disabled readOnly className="settings-readonly" />
            <small className="settings-field-note">{copy.settingsEmailHint}</small>
          </label>

          <div className="settings-language-field">
            <span>{copy.settingsLanguage}</span>
            <div className="language-toggle">
              <button
                className={`language-option${draft.locale === 'zh' ? ' active' : ''}`}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, locale: 'zh' }))}
                disabled={busy}
              >
                {copy.chinese}
              </button>
              <button
                className={`language-option${draft.locale === 'en' ? ' active' : ''}`}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, locale: 'en' }))}
                disabled={busy}
              >
                {copy.english}
              </button>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={busy}>
            {copy.cancel}
          </button>
          <button className="solid-button" type="button" onClick={onSave} disabled={busy}>
            {busy ? copy.authWorking : copy.save}
          </button>
        </div>
      </div>
    </div>
  );
}
