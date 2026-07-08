import { api } from "@/lib/api";

export type QueuedCapture = {
  id: string;
  file: Blob;
  filename: string;
  contentType: string;
  type: string;
  sourceLabel?: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  syncing?: boolean;
};

const DB_NAME = "cbf-offline";
const DB_VERSION = 1;
const STORE = "captureQueue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const req = action(store);
        let result = undefined as T;
        if (req) {
          req.onsuccess = () => {
            result = req.result;
          };
          req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        }
        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("IndexedDB transaction failed"));
        };
      })
  );
}

export async function addCapture(file: File, type: string, sourceLabel?: string) {
  const item: QueuedCapture = {
    id: crypto.randomUUID(),
    file,
    filename: file.name || `capture-${Date.now()}`,
    contentType: file.type || "application/octet-stream",
    type,
    sourceLabel,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await tx("readwrite", (store) => store.put(item));
  await registerBackgroundSync();
  return item;
}

export function listCaptures() {
  return tx<QueuedCapture[]>("readonly", (store) => store.getAll());
}

export function removeCapture(id: string) {
  return tx<void>("readwrite", (store) => {
    store.delete(id);
  });
}

async function markCapture(item: QueuedCapture, patch: Partial<QueuedCapture>) {
  await tx("readwrite", (store) => store.put({ ...item, ...patch }));
}

export async function flushCaptureQueue() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { synced: 0, failed: 0 };
  const queue = await listCaptures();
  let synced = 0;
  let failed = 0;
  for (const item of queue) {
    await markCapture(item, { syncing: true });
    const file = new File([item.file], item.filename, { type: item.contentType });
    const result = await api.tryUploadDocument(file, {
      type: item.type,
      source_channel: "upload",
      source_label: item.sourceLabel,
    });
    if (result.ok) {
      await removeCapture(item.id);
      synced += 1;
    } else {
      failed += 1;
      await markCapture(item, {
        attempts: item.attempts + 1,
        lastError: result.unauthorized ? "Sign in again before syncing." : result.error,
        syncing: false,
      });
      if (result.unauthorized) break;
    }
  }
  return { synced, failed };
}

export async function registerBackgroundSync() {
  if (typeof navigator === "undefined") return;
  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  const sync = registration ? (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync : undefined;
  await sync?.register("sync-captures").catch(() => undefined);
}
