import { patchProject, type UploadProgressSnapshot } from '../api';
import type { UiLocale } from '../app-copy';
import {
  filterSupportedImportFiles,
  getUserFacingErrorMessage,
  loadLocalImportModule,
  mergeLocalImportDrafts
} from '../app-utils';
import type { LocalImportDraft } from '../local-import';
import type { ProjectRecord } from '../types';
import {
  collectUploadedObjectReferencesFromProject,
  mergeUploadedObjectReferences
} from '../upload-flow';

interface UseProjectUploadImportInput {
  copy: {
    uploadNoSupportedFiles: string;
    uploadUnsupportedFiles: (count: number) => string;
    uploadRawSidecarFiles: (count: number) => string;
    uploadDuplicateFiles: (count: number) => string;
    uploadFailed: string;
  };
  localImportDrafts: Record<string, LocalImportDraft>;
  locale: UiLocale;
  setBusy: (busy: boolean) => void;
  setDragActive: (active: boolean) => void;
  setMessage: (message: string) => void;
  setUploadActive: (active: boolean) => void;
  setUploadMode: (mode: 'local' | 'originals' | null) => void;
  setUploadPercent: (percent: number) => void;
  setUploadSnapshot: (snapshot: UploadProgressSnapshot | null) => void;
  updateLocalImportDraft: (projectId: string, updater: (draft: LocalImportDraft) => LocalImportDraft) => void;
  upsertLocalImportDraft: (draft: LocalImportDraft) => void;
  upsertProject: (project: ProjectRecord) => void;
}

export function useProjectUploadImport({
  copy,
  localImportDrafts,
  locale,
  setBusy,
  setDragActive,
  setMessage,
  setUploadActive,
  setUploadMode,
  setUploadPercent,
  setUploadSnapshot,
  updateLocalImportDraft,
  upsertLocalImportDraft,
  upsertProject
}: UseProjectUploadImportInput) {
  async function handleUploadForProject(targetProject: ProjectRecord, files: FileList | File[] | null) {
    if (!files || files.length === 0) return;

    const { supported, unsupported, ignoredRawSidecars } = filterSupportedImportFiles(Array.from(files));
    if (!supported.length) {
      setMessage(copy.uploadNoSupportedFiles);
      return;
    }

    const existingDraft = localImportDrafts[targetProject.id] ?? null;
    const uploadedObjects = mergeUploadedObjectReferences(
      existingDraft?.uploadedObjects,
      collectUploadedObjectReferencesFromProject(targetProject)
    );
    setBusy(true);
    setUploadActive(true);
    setUploadMode('local');
    setUploadPercent(0);
    setUploadSnapshot(null);
    setDragActive(false);
    try {
      const { buildLocalImportDraft } = await loadLocalImportModule();
      const nextDraft = await buildLocalImportDraft(targetProject.id, supported, setUploadPercent, { previewMode: 'embedded' });
      const nextDraftWithUploads: LocalImportDraft = {
        ...nextDraft,
        uploadedObjects,
        uploadStatus: existingDraft?.uploadStatus ?? 'idle'
      };
      const response = await patchProject(targetProject.id, { currentStep: 2, status: 'review' });
      upsertProject(response.project);
      if (existingDraft) {
        const merged = mergeLocalImportDrafts(existingDraft, nextDraftWithUploads);
        const mergedDraft: LocalImportDraft = {
          ...merged.draft,
          uploadedObjects: mergeUploadedObjectReferences(merged.draft.uploadedObjects, uploadedObjects),
          uploadStatus: existingDraft.uploadStatus ?? 'idle'
        };
        updateLocalImportDraft(targetProject.id, () => mergedDraft);
        merged.unusedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        const notices = [
          unsupported.length ? copy.uploadUnsupportedFiles(unsupported.length) : '',
          ignoredRawSidecars.length ? copy.uploadRawSidecarFiles(ignoredRawSidecars.length) : '',
          merged.duplicateCount ? copy.uploadDuplicateFiles(merged.duplicateCount) : ''
        ].filter(Boolean);
        setMessage(notices.join(' '));
      } else {
        upsertLocalImportDraft(nextDraftWithUploads);
        const notices = [
          unsupported.length ? copy.uploadUnsupportedFiles(unsupported.length) : '',
          ignoredRawSidecars.length ? copy.uploadRawSidecarFiles(ignoredRawSidecars.length) : ''
        ].filter(Boolean);
        setMessage(notices.join(' '));
      }
    } catch (error) {
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
      setMessage(getUserFacingErrorMessage(error, copy.uploadFailed, locale));
    } finally {
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
      setBusy(false);
    }
  }

  return { handleUploadForProject };
}
