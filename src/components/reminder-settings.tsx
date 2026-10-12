"use client";

import { useEffect, useState } from "react";
import type { Messages } from "@/i18n/messages";

type State = "loading" | "unsupported" | "installFirst" | "notReady" | "blocked" | "off" | "on" | "busy";

function urlBase64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** Owners and stock keepers: turn reminders on for this phone. iPhone needs the app added to the Home Screen first. */
export function ReminderSettings({ t, owner }: { t: Messages; owner: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [key, setKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const set = (s: State) => !cancelled && setState(s);
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return set(ios && !standalone ? "installFirst" : "unsupported");
      const r = await fetch("/api/push/subscribe").then((x) => x.json()).catch(() => null);
      if (!r?.key) return set("notReady");
      if (!cancelled) setKey(r.key);
      if (Notification.permission === "denied") return set("blocked");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      set(sub && Notification.permission === "granted" ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    if (!key) return;
    setState("busy");
    setNote(null);
    try {
      // Must run straight from the tap: iPhone only asks inside a user gesture.
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error(String(res.status));
      setState("on");
    } catch {
      setNote(t.n.failed);
      setState("off");
    }
  }

  async function turnOff() {
    setState("busy");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setState("off");
  }

  async function test() {
    setNote(null);
    const r = await fetch("/api/push/test", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) setNote(t.n.failed);
  }

  if (state === "loading" || state === "unsupported") return null;
  const btn = "rounded-xl px-4 py-2.5 font-semibold";
  return (
    <section className="rounded-2xl border-2 border-stone-300 bg-white p-4 shadow-sm">
      <h2 className="text-xl font-bold">🔔 {t.n.title}</h2>
      {state === "on" ? (
        <>
          <p className="mt-1 font-semibold text-[#2e7d4f]">✓ {t.n.on}</p>
          <div className="mt-3 flex gap-2">
            <button className={`${btn} bg-[#1f4e79] text-white`} onClick={test}>
              {t.n.test}
            </button>
            <button className={`${btn} border border-stone-300`} onClick={turnOff}>
              {t.n.turnOff}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone-600">
            {state === "installFirst" ? t.n.installFirst : state === "blocked" ? t.n.blocked : state === "notReady" ? t.n.notReady : owner ? t.n.hint : t.n.hintKeeper}
          </p>
          {(state === "off" || state === "busy") && (
            <button className={`${btn} mt-3 w-full bg-[#1f4e79] py-3.5 text-lg text-white disabled:opacity-50`} disabled={state === "busy"} onClick={turnOn}>
              {t.n.turnOn}
            </button>
          )}
        </>
      )}
      {note && <p className="mt-2 text-sm text-red-700">{note}</p>}
    </section>
  );
}
