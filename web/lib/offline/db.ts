import Dexie, { type Table } from "dexie";

/** A capture awaiting upload. Lives in IndexedDB so it survives reloads/offline. */
export interface QueuedCapture {
  id: string;
  blob: Blob;
  filename: string;
  contentType: string;
  /** Backend document type hint ("receipt" | "statement" | …) or "" to let the server infer. */
  docType: string;
  sourceLabel?: string;
  /** Groups files uploaded together so the server can detect same-receipt images. */
  batchId?: string;
  /** Forces same-receipt merge for this drop when "single". */
  groupHint?: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  status: "queued" | "syncing" | "failed";
}

class OfflineDb extends Dexie {
  captures!: Table<QueuedCapture, string>;

  constructor() {
    super("cbf-offline-v2");
    this.version(1).stores({ captures: "id, createdAt, status" });
  }
}

export const db = new OfflineDb();
