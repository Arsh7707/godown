"use client";

/** Items shared into the app from WhatsApp (stored by the service worker, see public/sw.js). */
export interface SharedItem {
  text: string;
  files: File[];
}

export async function readShared(id: string): Promise<SharedItem | null> {
  if (!("caches" in window) || !/^[a-z0-9]+$/.test(id)) return null;
  const cache = await caches.open("ob-shared");
  const metaRes = await cache.match(`/shared/${id}/meta`);
  if (!metaRes) return null;
  const meta = (await metaRes.json()) as { text: string; files: { i: number; name: string; type: string }[] };
  const files: File[] = [];
  for (const f of meta.files) {
    const r = await cache.match(`/shared/${id}/${f.i}`);
    if (r) files.push(new File([await r.blob()], f.name, { type: f.type }));
  }
  return { text: meta.text, files };
}

export async function clearShared(id: string) {
  if (!("caches" in window)) return;
  const cache = await caches.open("ob-shared");
  for (const req of await cache.keys()) if (new URL(req.url).pathname.startsWith(`/shared/${id}/`)) await cache.delete(req);
}
