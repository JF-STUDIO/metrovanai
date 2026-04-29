import type { UploadedObjectReference } from './api';

const DB_NAME = 'metrovan-uploads';
const STORE_NAME = 'completed-by-project';
const DB_VERSION = 1;

export interface PersistedUploadedObject {
  fileIdentity: string;
  object: UploadedObjectReference;
}

interface PersistedRecord {
  id: string;
  objects: PersistedUploadedObject[];
  updatedAt: number;
}

function hasIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openUploadResumeDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('Failed to open upload resume storage.')));
  });
}

function runUploadResumeStore<T>(mode: IDBTransactionMode, runner: (store: IDBObjectStore) => IDBRequest<T> | void) {
  return new Promise<T | undefined>((resolve, reject) => {
    void openUploadResumeDb()
      .then((db) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = runner(store);
        let result: T | undefined;

        if (request) {
          request.addEventListener('success', () => {
            result = request.result;
          });
          request.addEventListener('error', () => reject(request.error ?? new Error('Upload resume storage request failed.')));
        }

        transaction.addEventListener('complete', () => {
          db.close();
          resolve(result);
        });
        transaction.addEventListener('error', () => {
          db.close();
          reject(transaction.error ?? new Error('Upload resume storage transaction failed.'));
        });
        transaction.addEventListener('abort', () => {
          db.close();
          reject(transaction.error ?? new Error('Upload resume storage transaction aborted.'));
        });
      })
      .catch(reject);
  });
}

async function readRecord(projectId: string): Promise<PersistedRecord | null> {
  if (!hasIndexedDb()) {
    return null;
  }

  try {
    const record = await runUploadResumeStore<PersistedRecord>('readonly', (store) => store.get(projectId));
    return record ?? null;
  } catch {
    return null;
  }
}

async function writeRecord(record: PersistedRecord) {
  if (!hasIndexedDb()) {
    return;
  }

  try {
    await runUploadResumeStore('readwrite', (store) => store.put({ ...record, updatedAt: Date.now() }));
  } catch {
    // Upload resume storage is best-effort; never block the actual upload.
  }
}

export async function readPersistedCompleted(projectId: string): Promise<PersistedUploadedObject[]> {
  const record = await readRecord(projectId);
  return record?.objects ?? [];
}

export async function appendPersistedCompleted(projectId: string, fileIdentity: string, object: UploadedObjectReference) {
  const existing = (await readRecord(projectId)) ?? { id: projectId, objects: [], updatedAt: 0 };
  const nextObjects = existing.objects.filter(
    (item) => item.fileIdentity !== fileIdentity && item.object.storageKey !== object.storageKey
  );
  nextObjects.push({ fileIdentity, object });
  await writeRecord({ ...existing, objects: nextObjects });
}

export async function clearPersistedProject(projectId: string) {
  if (!hasIndexedDb()) {
    return;
  }

  try {
    await runUploadResumeStore('readwrite', (store) => store.delete(projectId));
  } catch {
    // Upload resume storage is best-effort; a stale record is harmless after server finalize succeeds.
  }
}
