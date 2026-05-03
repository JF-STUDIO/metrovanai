import type { UploadedObjectReference } from './api';
import type { LocalExposureDraft, LocalHdrItemDraft, LocalImportDraft } from './local-import';
import type { ProjectRecord } from './types';
import { normalizeFileIdentity } from './app-utils';

export function collectLocalHdrItemFiles(hdrItem: LocalHdrItemDraft) {
  const filesByIdentity = new Map<string, File>();
  for (const exposure of hdrItem.exposures) {
    const key = normalizeFileIdentity(exposure.originalName || exposure.fileName);
    if (!filesByIdentity.has(key)) {
      filesByIdentity.set(key, exposure.file);
    }
  }
  return Array.from(filesByIdentity.values());
}

export function buildHdrLayoutPayload(
  draft: LocalImportDraft,
  uploadedObjects: UploadedObjectReference[] = draft.uploadedObjects ?? []
) {
  const uploadsByIdentity = new Map<string, UploadedObjectReference[]>();
  for (const uploaded of uploadedObjects) {
    const key = normalizeFileIdentity(uploaded.originalName);
    uploadsByIdentity.set(key, [...(uploadsByIdentity.get(key) ?? []), uploaded]);
  }

  const takeUploadedObject = (exposure: LocalExposureDraft) => {
    const key = normalizeFileIdentity(exposure.originalName || exposure.fileName);
    const matches = uploadsByIdentity.get(key);
    return matches?.shift() ?? null;
  };

  return draft.hdrItems
    .filter((hdrItem) => hdrItem.exposures.length > 0)
    .map((hdrItem) => {
      const selectedExposure =
        hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ??
        hdrItem.exposures[0] ??
        null;
      const exposures = hdrItem.exposures.map((exposure) => {
        const uploaded = takeUploadedObject(exposure);
        return {
          originalName: exposure.originalName || exposure.fileName,
          fileName: exposure.fileName,
          extension: exposure.extension,
          mimeType: exposure.mimeType || uploaded?.mimeType || 'application/octet-stream',
          size: exposure.size || uploaded?.size,
          isRaw: exposure.isRaw,
          storageKey: uploaded?.storageKey ?? null,
          captureTime: exposure.captureTime,
          sequenceNumber: exposure.sequenceNumber,
          exposureCompensation: exposure.exposureCompensation,
          exposureSeconds: exposure.exposureSeconds,
          iso: exposure.iso,
          fNumber: exposure.fNumber,
          focalLength: exposure.focalLength
        };
      });
      return {
        exposureOriginalNames: hdrItem.exposures.map((exposure) => exposure.originalName || exposure.fileName),
        selectedOriginalName: selectedExposure?.originalName ?? selectedExposure?.fileName ?? null,
        exposures
      };
    });
}

export function getUploadReferenceIdentity(input: { originalName: string; size: number }) {
  return `${normalizeFileIdentity(input.originalName)}:${input.size}`;
}

export function getLocalFileUploadIdentity(file: File) {
  const maybePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const relativePath = typeof maybePath === 'string' ? maybePath.trim().toLowerCase() : '';
  return `${normalizeFileIdentity(file.name)}:${file.size}:${file.lastModified}:${relativePath}`;
}

export function mergeUploadedObjectReferences(
  current: UploadedObjectReference[] | undefined,
  additions: UploadedObjectReference[]
) {
  const byIdentity = new Map<string, UploadedObjectReference>();
  for (const uploaded of current ?? []) {
    byIdentity.set(getUploadReferenceIdentity(uploaded), uploaded);
  }
  for (const uploaded of additions) {
    byIdentity.set(getUploadReferenceIdentity(uploaded), uploaded);
  }
  return Array.from(byIdentity.values());
}

export function getUploadedObjectsForFiles(uploadedObjects: UploadedObjectReference[], files: File[]) {
  const byIdentity = new Map(uploadedObjects.map((uploaded) => [getUploadReferenceIdentity(uploaded), uploaded]));
  return files
    .map((file) => byIdentity.get(getUploadReferenceIdentity({ originalName: file.name, size: file.size })))
    .filter((uploaded): uploaded is UploadedObjectReference => Boolean(uploaded));
}

export function collectUploadedObjectReferencesFromProject(project: ProjectRecord) {
  const uploads: UploadedObjectReference[] = [];
  const seen = new Set<string>();
  for (const hdrItem of project.hdrItems) {
    for (const exposure of hdrItem.exposures) {
      const storageKey = (exposure as typeof exposure & { storageKey?: string | null }).storageKey;
      if (!storageKey) {
        continue;
      }
      const uploaded = {
        originalName: exposure.originalName || exposure.fileName,
        mimeType: exposure.mimeType || 'application/octet-stream',
        size: exposure.size,
        storageKey
      };
      const identity = getUploadReferenceIdentity(uploaded);
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      uploads.push(uploaded);
    }
  }
  return uploads;
}
