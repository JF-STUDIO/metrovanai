import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { UiLocale } from '../app-copy';
import { IMPORT_FILE_ACCEPT } from '../app-utils';
import type { StudioFeatureDefinition } from '../studio-features';

interface FeatureCreateDialogCopy {
  authWorking: string;
  cancel: string;
  close: string;
  projectName: string;
}

interface FeatureCreateDialogProps {
  busy: boolean;
  copy: FeatureCreateDialogCopy;
  dragActive: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  files: File[];
  locale: UiLocale;
  newProjectName: string;
  selectedFeature: StudioFeatureDefinition;
  setDragActive: Dispatch<SetStateAction<boolean>>;
  setNewProjectName: Dispatch<SetStateAction<string>>;
  onClose: () => void;
  onCreate: () => void;
  onFiles: (files: FileList | null) => void;
}

export function FeatureCreateDialog({
  busy,
  copy,
  dragActive,
  fileInputRef,
  files,
  locale,
  newProjectName,
  selectedFeature,
  setDragActive,
  setNewProjectName,
  onClose,
  onCreate,
  onFiles
}: FeatureCreateDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card feature-create-modal" onClick={(event) => event.stopPropagation()}>
        <button className="feature-create-close" type="button" onClick={onClose} aria-label={copy.close}>
          ×
        </button>

        <section className={`feature-create-summary tone-${selectedFeature.tone}`}>
          <div className="feature-create-icon" aria-hidden="true">
            {selectedFeature.beforeImage && selectedFeature.afterImage ? (
              <>
                <img src={selectedFeature.beforeImage} alt="" decoding="async" />
                <img src={selectedFeature.afterImage} alt="" decoding="async" />
              </>
            ) : (
              <span />
            )}
          </div>
          <div>
            <strong>{selectedFeature.title[locale]}</strong>
            <span>{selectedFeature.detail[locale]}</span>
          </div>
        </section>

        <div className="feature-create-body">
          <div className="feature-create-title">
            <h2>{locale === 'en' ? 'Project name' : '设置项目名称'}</h2>
            <p>{locale === 'en' ? 'Name this project and upload the photos that need processing.' : '为这个项目命名，并上传需要处理的照片。'}</p>
          </div>

          <label className="feature-create-field">
            <span>{copy.projectName}</span>
            <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder={selectedFeature.defaultName[locale]} />
          </label>

          <label className="feature-create-field feature-create-priority">
            <span>{locale === 'en' ? 'Processing priority' : '处理优先级'}</span>
            <select defaultValue="standard" aria-label={locale === 'en' ? 'Processing priority' : '处理优先级'}>
              <option value="standard">{locale === 'en' ? 'Standard (starts within 10 minutes)' : '标准（10 分钟内开始）'}</option>
              <option value="normal">{locale === 'en' ? 'Normal queue' : '普通队列'}</option>
            </select>
          </label>

          <div
            className={`feature-create-dropzone${dragActive ? ' drag-active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              onFiles(event.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={IMPORT_FILE_ACCEPT}
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <span className="feature-create-upload-arrow" aria-hidden="true">↑</span>
            <strong>{locale === 'en' ? 'Drag RAW / JPG here, or click to choose files' : '拖拽 RAW / JPG 到这里，或点击选择文件'}</strong>
            <em>{locale === 'en' ? 'Supports ARW, CR2, CR3, NEF, RAF, DNG, JPG · up to 2 GB per file' : '支持 ARW、CR2、CR3、NEF、RAF、DNG、JPG · 单张最大 2 GB'}</em>
          </div>

          {files.length > 0 && (
            <div className="feature-create-selected-files" aria-live="polite">
              <strong>{locale === 'en' ? `${files.length} files selected` : `已选择 ${files.length} 张照片`}</strong>
              <span>
                {files.slice(0, 3).map((file) => file.name).join(' · ')}
                {files.length > 3 ? ' · ...' : ''}
              </span>
            </div>
          )}
        </div>

        <div className="modal-actions feature-create-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={busy}>
            {copy.cancel}
          </button>
          <button className="solid-button" type="button" onClick={onCreate} disabled={busy}>
            {busy ? copy.authWorking : locale === 'en' ? 'Create project and start' : '创建项目并开始'}
          </button>
        </div>
      </div>
    </div>
  );
}
