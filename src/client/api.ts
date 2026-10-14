"use client";

export type ApiResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; code: string; message?: string; details?: Record<string, unknown> };

export class NetworkError extends Error {}

/** The firm this screen was opened in (set by the root layout). */
export function currentFirm(): string | null {
  if (typeof document === "undefined") return null;
  return document.querySelector('meta[name="godown-firm"]')?.getAttribute("content") || null;
}

function firmHeaders(firm: string | null | undefined): Record<string, string> {
  const f = firm === undefined ? currentFirm() : firm;
  return f ? { "x-godown-firm": f } : {};
}

/**
 * The login moved to another firm (e.g. switched in another window) while this
 * screen still shows the old one: reload so the person sees which firm they are in.
 */
function firmChanged(res: Response, quiet: boolean) {
  if (res.status !== 409 || quiet) return;
  window.location.reload();
}

/** `firm`: send for this firm instead of the screen's (the outbox sends each entry for the firm it was made in). */
export async function postJson<T>(url: string, body: unknown, opts: { firm?: string | null } = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...firmHeaders(opts.firm) }, body: JSON.stringify(body) });
  } catch {
    throw new NetworkError("offline");
  }
  firmChanged(res, opts.firm !== undefined);
  if (res.status === 401) {
    // Session ended (logged out elsewhere / expired). Called from async helpers, not render.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
    throw new NetworkError("unauthenticated");
  }
  return (await res.json().catch(() => ({ ok: false, code: "UNKNOWN" }))) as ApiResult<T>;
}

export async function getJson<T>(url: string): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: firmHeaders(undefined) });
  } catch {
    throw new NetworkError("offline");
  }
  firmChanged(res, false);
  return (await res.json().catch(() => ({ ok: false, code: "UNKNOWN" }))) as ApiResult<T>;
}

export async function upload(captureId: string, kind: "slip_photo" | "voice_note" | "parcel_photo", blob: Blob, firm?: string | null): Promise<string> {
  const form = new FormData();
  form.append("captureId", captureId);
  form.append("kind", kind);
  form.append("file", blob, kind);
  let res: Response;
  try {
    res = await fetch("/api/uploads", { method: "POST", body: form, headers: firmHeaders(firm) });
  } catch {
    throw new NetworkError("offline");
  }
  const r = (await res.json()) as ApiResult<{ attachmentId: string }>;
  if (!r.ok) throw new Error(r.code);
  return r.attachmentId;
}

export const newId = () => crypto.randomUUID();
