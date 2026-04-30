import type { UiLocale } from '../app-copy';
import type { ProjectRecord } from '../types';

interface DeleteProjectConfirmDialogCopy {
  cancel: string;
  delete: string;
  deleteProjectConfirm: (projectName: string) => string;
}

interface DeleteProjectConfirmDialogProps {
  copy: DeleteProjectConfirmDialogCopy;
  locale: UiLocale;
  project: ProjectRecord;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteProjectConfirmDialog({
  copy,
  locale,
  project,
  onCancel,
  onConfirm
}: DeleteProjectConfirmDialogProps) {
  return (
    <div className="modal-backdrop delete-confirm-backdrop" onClick={onCancel}>
      <div className="modal-card delete-confirm-card" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title">
        <div className="delete-confirm-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
        </div>
        <strong id="delete-confirm-title" className="delete-confirm-title">
          {locale === 'zh' ? '删除项目' : 'Delete Project'}
        </strong>
        <p className="delete-confirm-desc">{copy.deleteProjectConfirm(project.name)}</p>
        <div className="delete-confirm-actions">
          <button className="ghost-button delete-confirm-cancel" type="button" onClick={onCancel}>
            {copy.cancel}
          </button>
          <button className="delete-confirm-btn" type="button" onClick={onConfirm}>
            {copy.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
