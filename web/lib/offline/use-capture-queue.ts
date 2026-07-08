"use client";

import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db, type QueuedCapture } from "./db";
import { flushQueue } from "./sync";

/** Live view of the capture queue plus connectivity, auto-flushing when online returns. */
export function useCaptureQueue() {
  const [items, setItems] = useState<QueuedCapture[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sub = liveQuery(() => db.captures.orderBy("createdAt").reverse().toArray()).subscribe({
      next: setItems,
      error: () => setItems([]),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    const onOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return { items, online };
}
