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
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const formatFileSize = (bytes: number) => {
    if (!bytes) return locale === 'en' ? '0 MB' : '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card feature-create-modal" onClick={(event) => event.stopPropagation()}>
        <button className="feature-create-close" type="button" onClick={onClose} aria-label={copy.close}>
          ×
        </button>

        <div className="feature-create-shell">
          <aside className={`feature-create-summary tone-${selectedFeature.tone}`}>
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
            <div className="feature-create-summary-copy">
              <span className="feature-create-kicker">{locale === 'en' ? 'Selected workflow' : '已选择功能'}</span>
              <strong>{selectedFeature.title[locale]}</strong>
              <p>{selectedFeature.detail[locale]}</p>
            </div>
            <div className="feature-create-steps" aria-label={locale === 'en' ? 'Project setup steps' : '项目创建步骤'}>
              <span>{locale === 'en' ? '1. Name project' : '1. 命名项目'}</span>
              <span>{locale === 'en' ? '2. Import photos' : '2. 导入照片'}</span>
              <span>{locale === 'en' ? '3. Review then process' : '3. 检查后开始处理'}</span>
            </div>
          </aside>

          <section className="feature-create-body">
            <div className="feature-create-title">
              <span className="feature-create-kicker">{locale === 'en' ? 'Start a project' : '开始新项目'}</span>
              <h2>{locale === 'en' ? 'Create and import photos' : '创建项目并导入照片'}</h2>
              <p>{locale === 'en' ? 'Set a clear project name first. You can import RAW or JPG files now, or add photos after the project opens.' : '先设置一个清楚的项目名称。可以现在导入 RAW/JPG，也可以创建后再上传。'}</p>
            </div>

            <label className="feature-create-field">
              <span>{copy.projectName}</span>
              <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder={selectedFeature.defaultName[locale]} autoFocus />
            </label>

            <div
              className={`feature-create-dropzone${dragActive ? ' drag-active' : ''}${files.length ? ' has-files' : ''}`}
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
              <div>
                <strong>{locale === 'en' ? 'Import photos' : '导入照片'}</strong>
                <em>{locale === 'en' ? 'Drag RAW / JPG here, or click to choose files' : '拖拽 RAW / JPG 到这里，或点击选择文件'}</em>
              </div>
              <span className="feature-create-file-support">
                {locale === 'en' ? 'ARW, CR2, CR3, NEF, RAF, DNG, JPG · up to 2 GB each' : '支持 ARW、CR2、CR3、NEF、RAF、DNG、JPG · 单张最大 2 GB'}
              </span>
            </div>

            {files.length > 0 ? (
              <div className="feature-create-selected-files" aria-live="polite">
                <div>
                  <strong>{locale === 'en' ? `${files.length} files selected` : `已选择 ${files.length} 张照片`}</strong>
                  <span>{formatFileSize(totalBytes)}</span>
                </div>
                <ol>
                  {files.slice(0, 4).map((file) => (
                    <li key={`${file.name}:${file.size}:${file.lastModified}`}>
                      <span>{file.name}</span>
                      <em>{formatFileSize(file.size)}</em>
                    </li>
                  ))}
                </ol>
                {files.length > 4 ? <small>{locale === 'en' ? `+ ${files.length - 4} more files` : `还有 ${files.length - 4} 个文件`}</small> : null}
              </div>
            ) : (
              <div className="feature-create-empty-note">
                {locale === 'en' ? 'No files selected yet. Creating the project without files is allowed.' : '还没有选择照片。也可以先创建项目，进入后再上传。'}
              </div>
            )}
          </section>
        </div>

        <div className="modal-actions feature-create-actions">
          <div>
            <strong>{locale === 'en' ? 'Ready when the project name is set' : '项目名填好后即可开始'}</strong>
            <span>{files.length ? (locale === 'en' ? `${files.length} files will upload after creation.` : `创建后会上传 ${files.length} 张照片。`) : (locale === 'en' ? 'You can import files later from the workspace.' : '也可以稍后在工作台导入照片。')}</span>
          </div>
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
