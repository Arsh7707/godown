"use client";

/**
 * Entries made without internet are kept on the phone (IndexedDB) and sent
 * when the connection returns. Every item carries its client-generated id,
 * so sending twice never saves twice.
 *
 * - "save": a confirmed form entry (the user already checked it).
 * - "capture": a photo / voice note / message still to be read. Once read it
 *   waits in the Inbox for the user to confirm; nothing is saved unreviewed.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { NetworkError, postJson, upload } from "./api";

export type OutboxItem =
  | {
      id: string;
      type: "save";
      kind: "order" | "dispatch" | "receipt" | "count";
      body: Record<string, unknown>;
      /** For the list: party name and a short line. */
      label: string;
      state: "queued" | "done" | "failed";
      error?: string;
      share?: { text: string; url: string };
      createdAt: number;
    }
  | {
      id: string;
      type: "capture";
      kind: "order" | "dispatch" | "receipt" | "count";
      captureId: string;
      inputMethod: "photo" | "voice" | "text";
      blob?: Blob;
      blobKind?: "slip_photo" | "voice_note";
      text?: string;
      audioSeconds?: number;
      /** A past day picked in History, for entries that don't say a date. */
      defaultDate?: string;
      attachmentId?: string;
      state: "queued" | "read" | "failed";
      error?: string;
      createdAt: number;
    };

const DB = "order-book";
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// Tiny change feed so screens update when the outbox changes.
let snapshot: OutboxItem[] = [];
const listeners = new Set<() => void>();
async function refresh() {
  snapshot = ((await tx("readonly", (s) => s.getAll())) as OutboxItem[]).sort((a, b) => a.createdAt - b.createdAt);
  listeners.forEach((l) => l());
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
/** New items get their timestamp here. */
export type NewOutboxItem = DistributiveOmit<OutboxItem, "createdAt"> & { createdAt?: number };

export async function put(item: NewOutboxItem) {
  await tx("readwrite", (s) => s.put({ ...item, createdAt: item.createdAt ?? Date.now() }));
  await refresh();
  void sync();
}
export async function get(id: string): Promise<OutboxItem | undefined> {
  return (await tx("readonly", (s) => s.get(id))) as OutboxItem | undefined;
}
export async function remove(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  await refresh();
}

export function useOutbox(): OutboxItem[] {
  const items = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => EMPTY,
  );
  useEffect(() => {
    void refresh();
  }, []);
  return items;
}
const EMPTY: OutboxItem[] = [];

let running = false;
/** Sends everything queued, oldest first. Stops at the first network failure; retried later. */
export async function sync(): Promise<void> {
  if (running || typeof indexedDB === "undefined") return;
  running = true;
  try {
    await refresh();
    for (const item of snapshot) {
      if (item.state !== "queued") continue;
      try {
        if (item.type === "save") {
          const url = item.kind === "order" ? "/api/orders" : item.kind === "dispatch" ? "/api/dispatches" : "/api/stock";
          const r = await postJson<{ share: { text: string; url: string } }>(url, item.body);
          await tx("readwrite", (s) => s.put(r.ok ? { ...item, state: "done", share: r.share } : { ...item, state: "failed", error: r.code }));
        } else {
          let attachmentId = item.attachmentId;
          if (item.blob && item.blobKind && !attachmentId) {
            attachmentId = await upload(item.captureId, item.blobKind, item.blob);
            await tx("readwrite", (s) => s.put({ ...item, attachmentId }));
          }
          const r = await postJson("/api/extract", {
            captureId: item.captureId,
            kind: item.kind === "receipt" || item.kind === "count" ? "stock" : item.kind,
            inputMethod: item.inputMethod,
            text: item.text,
            imageAttachmentId: item.blobKind === "slip_photo" ? attachmentId : undefined,
            audioAttachmentId: item.blobKind === "voice_note" ? attachmentId : undefined,
            audioSeconds: item.audioSeconds,
            defaultDate: item.defaultDate,
          });
          // The stored reading is fetched again (free, idempotent) when the user opens it from the Inbox.
          await tx("readwrite", (s) => s.put(r.ok ? { ...item, attachmentId, blob: undefined, state: "read" } : { ...item, attachmentId, state: "failed", error: r.code }));
        }
      } catch (e) {
        if (e instanceof NetworkError) break;
        await tx("readwrite", (s) => s.put({ ...item, state: "failed", error: e instanceof Error ? e.message : "UNKNOWN" }));
      }
      await refresh();
    }
    // Forget sent entries after a day.
    for (const item of snapshot) if (item.type === "save" && item.state === "done" && Date.now() - item.createdAt > 86_400_000) await tx("readwrite", (s) => s.delete(item.id));
    await refresh();
  } finally {
    running = false;
  }
}

/** Keeps syncing while the app is open: on load, when back online, when reopened, and every 30s. */
export function useAutoSync() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const go = () => void sync();
    const on = () => {
      setOnline(true);
      go();
    };
    const off = () => setOnline(false);
    const vis = () => document.visibilityState === "visible" && go();
    const t0 = setTimeout(() => setOnline(navigator.onLine), 0);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", vis);
    const timer = setInterval(go, 30_000);
    go();
    return () => {
      clearTimeout(t0);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(timer);
    };
  }, []);
  return online;
}
