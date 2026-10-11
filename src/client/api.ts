"use client";

export type ApiResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; code: string; message?: string; details?: Record<string, unknown> };

export class NetworkError extends Error {}

export async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new NetworkError("offline");
  }
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
    res = await fetch(url);
  } catch {
    throw new NetworkError("offline");
  }
  return (await res.json().catch(() => ({ ok: false, code: "UNKNOWN" }))) as ApiResult<T>;
}

export async function upload(captureId: string, kind: "slip_photo" | "voice_note" | "parcel_photo", blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("captureId", captureId);
  form.append("kind", kind);
  form.append("file", blob, kind);
  let res: Response;
  try {
    res = await fetch("/api/uploads", { method: "POST", body: form });
  } catch {
    throw new NetworkError("offline");
  }
  const r = (await res.json()) as ApiResult<{ attachmentId: string }>;
  if (!r.ok) throw new Error(r.code);
  return r.attachmentId;
}

export const newId = () => crypto.randomUUID();
