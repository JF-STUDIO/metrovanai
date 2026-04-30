import type { Dispatch, SetStateAction } from 'react';
import type { DownloadDraft } from '../app-utils';
import type { ProjectRecord } from '../types';

interface ProjectDownloadDialogCopy {
  cancel: string;
  close: string;
  downloadCustomHint: string;
  downloadCustomPrefix: string;
  downloadCustomTitle: string;
  downloadFolderFlat: string;
  downloadFolderGrouped: string;
  downloadFolderLabel: string;
  downloadFolderMode: string;
  downloadGenerate: string;
  downloadGenerating: string;
  downloadHdHint: string;
  downloadHdTitle: string;
  downloadHeight: string;
  downloadLongEdge: string;
  downloadNamingCustomPrefix: string;
  downloadNamingMode: string;
  downloadNamingOriginal: string;
  downloadNamingSequence: string;
  downloadNote: string;
  downloadSectionOrganize: string;
  downloadSectionSizes: string;
  downloadSettings: string;
  downloadWidth: string;
}

interface ProjectDownloadDialogProps {
  busy: boolean;
  copy: ProjectDownloadDialogCopy;
  draft: DownloadDraft;
  project: ProjectRecord;
  stageText: string;
  setDraft: Dispatch<SetStateAction<DownloadDraft>>;
  onClose: () => void;
  onConfirm: () => void;
}

export function ProjectDownloadDialog({
  busy,
  copy,
  draft,
  project,
  stageText,
  setDraft,
  onClose,
  onConfirm
}: ProjectDownloadDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card download-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <strong>{copy.downloadSettings}</strong>
            <span className="muted">{project.name}</span>
          </div>
          <button className="close-button" type="button" onClick={onClose} disabled={busy} aria-label={copy.close}>
            ×
          </button>
        </div>

        <div className="download-section">
          <p className="download-section-label">{copy.downloadSectionOrganize}</p>
          <div className="form-grid download-grid">
            <label>
              <span>{copy.downloadFolderMode}</span>
              <select
                value={draft.folderMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    folderMode: event.target.value as DownloadDraft['folderMode']
                  }))
                }
                disabled={busy}
              >
                <option value="grouped">{copy.downloadFolderGrouped}</option>
                <option value="flat">{copy.downloadFolderFlat}</option>
              </select>
            </label>

            <label>
              <span>{copy.downloadNamingMode}</span>
              <select
                value={draft.namingMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    namingMode: event.target.value as DownloadDraft['namingMode']
                  }))
                }
                disabled={busy}
              >
                <option value="sequence">{copy.downloadNamingSequence}</option>
                <option value="original">{copy.downloadNamingOriginal}</option>
                <option value="custom-prefix">{copy.downloadNamingCustomPrefix}</option>
              </select>
            </label>

            {draft.namingMode === 'custom-prefix' && (
              <label>
                <span>{copy.downloadCustomPrefix}</span>
                <input
                  value={draft.customPrefix}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      customPrefix: event.target.value
                    }))
                  }
                  placeholder="metrovan"
                  disabled={busy}
                />
              </label>
            )}
          </div>
        </div>

        <div className="download-section">
          <p className="download-section-label">{copy.downloadSectionSizes}</p>
          <div className="download-variants">
            <label className="download-variant-row">
              <input
                type="checkbox"
                checked={draft.includeHd}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    includeHd: event.target.checked
                  }))
                }
                disabled={busy}
              />
              <div>
                <strong>{copy.downloadHdTitle}</strong>
                <span>{copy.downloadHdHint}</span>
              </div>
            </label>

            <label className="download-variant-row">
              <input
                type="checkbox"
                checked={draft.includeCustom}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    includeCustom: event.target.checked
                  }))
                }
                disabled={busy}
              />
              <div>
                <strong>{copy.downloadCustomTitle}</strong>
                <span>{copy.downloadCustomHint}</span>
              </div>
            </label>

            {draft.includeCustom && (
              <div className="form-grid download-custom-grid">
                <label>
                  <span>{copy.downloadFolderLabel}</span>
                  <input
                    value={draft.customLabel}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        customLabel: event.target.value
                      }))
                    }
                    placeholder="Custom"
                    disabled={busy}
                  />
                </label>
                <label>
                  <span>{copy.downloadLongEdge}</span>
                  <input
                    value={draft.customLongEdge}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        customLongEdge: event.target.value
                      }))
                    }
                    placeholder="3000"
                    disabled={busy}
                  />
                </label>
                <label>
                  <span>{copy.downloadWidth}</span>
                  <input
                    value={draft.customWidth}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        customWidth: event.target.value
                      }))
                    }
                    placeholder="2048"
                    disabled={busy}
                  />
                </label>
                <label>
                  <span>{copy.downloadHeight}</span>
                  <input
                    value={draft.customHeight}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        customHeight: event.target.value
                      }))
                    }
                    placeholder="1365"
                    disabled={busy}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <p className="download-note">{copy.downloadNote}</p>

        {busy && (
          <div className="download-progress">
            <span className="download-progress-spinner" />
            <span>{stageText || copy.downloadGenerating}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={busy}>
            {copy.cancel}
          </button>
          <button className="solid-button" type="button" onClick={onConfirm} disabled={busy}>
            {copy.downloadGenerate}
          </button>
        </div>
      </div>
    </div>
  );
}
