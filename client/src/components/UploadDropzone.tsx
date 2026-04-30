import type { DragEvent } from 'react';

interface UploadDropzoneCopy {
  selectPhotos: string;
  uploadPhotos: string;
  uploadPhotosHint: string;
}

interface UploadDropzoneProps {
  copy: UploadDropzoneCopy;
  dragActive: boolean;
  showUploadProgress: boolean;
  uploadProgressLabel: string;
  uploadProgressWidth: number;
  onDragActiveChange: (active: boolean) => void;
  onFiles: (files: FileList) => void;
  onTriggerFilePicker: () => void;
}

export function UploadDropzone({
  copy,
  dragActive,
  showUploadProgress,
  uploadProgressLabel,
  uploadProgressWidth,
  onDragActiveChange,
  onFiles,
  onTriggerFilePicker
}: UploadDropzoneProps) {
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    onFiles(event.dataTransfer.files);
  };

  return (
    <section
      className={`panel upload-dropzone${dragActive ? ' drag-active' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        onDragActiveChange(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        onDragActiveChange(false);
      }}
      onDrop={handleDrop}
    >
      <div>
        <strong>{copy.uploadPhotos}</strong>
        <p>{copy.uploadPhotosHint}</p>
      </div>
      <div className="upload-actions">
        <button className="solid-button" type="button" onClick={onTriggerFilePicker}>
          {copy.selectPhotos}
        </button>
        {showUploadProgress && <span className="meta-pill">{uploadProgressLabel}</span>}
      </div>
      {showUploadProgress && (
        <div className="upload-progress-inline" aria-live="polite">
          <div className="upload-progress-bar">
            <span style={{ width: `${uploadProgressWidth}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}
