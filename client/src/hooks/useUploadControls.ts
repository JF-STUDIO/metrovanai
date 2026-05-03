import { useRef, useState } from 'react';
import type { UploadPauseController, UploadProgressSnapshot } from '../api';
import type { FailedUploadEntry } from '../app-utils';

export function useUploadControls() {
  const [uploadActive, setUploadActive] = useState(false);
  const [uploadMode, setUploadMode] = useState<'local' | 'originals' | null>(null);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadSnapshot, setUploadSnapshot] = useState<UploadProgressSnapshot | null>(null);
  const [uploadPaused, setUploadPaused] = useState(false);
  const [failedUploadFiles, setFailedUploadFiles] = useState<FailedUploadEntry[]>([]);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const uploadPausedRef = useRef(false);
  const uploadPauseResolversRef = useRef<Array<() => void>>([]);
  const uploadPauseControllerRef = useRef<UploadPauseController>({
    isPaused: () => uploadPausedRef.current,
    waitUntilResumed: (signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (!uploadPausedRef.current) {
          resolve();
          return;
        }

        function cleanup() {
          uploadPauseResolversRef.current = uploadPauseResolversRef.current.filter((resolver) => resolver !== resume);
          signal?.removeEventListener('abort', abort);
        }
        const resume = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(new DOMException('Upload cancelled.', 'AbortError'));
        };

        uploadPauseResolversRef.current.push(resume);
        signal?.addEventListener('abort', abort, { once: true });
      })
  });

  function resolveUploadPauseWaiters() {
    const resolvers = uploadPauseResolversRef.current.splice(0);
    resolvers.forEach((resolve) => resolve());
  }

  function resetUploadPause() {
    uploadPausedRef.current = false;
    setUploadPaused(false);
    resolveUploadPauseWaiters();
  }

  function pauseUpload() {
    if (!uploadActive) return false;
    uploadPausedRef.current = true;
    setUploadPaused(true);
    setUploadSnapshot((snapshot) => (snapshot ? { ...snapshot, stage: 'paused', offline: false } : snapshot));
    return true;
  }

  function resumeUpload() {
    if (!uploadPausedRef.current) return false;
    uploadPausedRef.current = false;
    setUploadPaused(false);
    resolveUploadPauseWaiters();
    setUploadSnapshot((snapshot) => (snapshot?.stage === 'paused' ? { ...snapshot, stage: 'uploading', offline: false } : snapshot));
    return true;
  }

  function cancelUpload() {
    uploadAbortControllerRef.current?.abort();
  }

  return {
    failedUploadFiles,
    setFailedUploadFiles,
    setUploadActive,
    setUploadMode,
    setUploadPaused,
    setUploadPercent,
    setUploadSnapshot,
    uploadAbortControllerRef,
    uploadActive,
    uploadMode,
    uploadPauseControllerRef,
    uploadPaused,
    uploadPercent,
    uploadSnapshot,
    cancelUpload,
    pauseUpload,
    resetUploadPause,
    resumeUpload
  };
}
