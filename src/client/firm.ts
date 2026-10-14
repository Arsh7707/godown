"use client";

import { postJson } from "./api";

/** Move this login to another firm, then open `next` in it (a full reload, so every screen shows the new firm). */
export async function switchFirm(companyId: string, next = "/") {
  const r = await postJson("/api/firm", { action: "switch", companyId }, { firm: null });
  if (!r.ok) return r;
  window.location.href = next;
  return r;
}
