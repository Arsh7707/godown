import "server-only";
import { after } from "next/server";
import { db } from "@/db/client";
import type { SessionUser } from "@/auth/login";
import { webPushSender } from "./push";
import { learnAliases, type Pick } from "@/masters/learn";
import { ctxFor } from "@/auth/session";
import { checkLowStock, checkOverStock, notifyStaffActivity, type StaffEvent } from "./reminders";

/** Run alert checks after the response is sent, so saving never waits on them or fails because of them. */
function later(name: string, fn: () => Promise<unknown>) {
  after(async () => {
    try {
      await fn();
    } catch (e) {
      console.error(`${name} check failed`, e);
    }
  });
}

/** Anything that can move free stock: orders, dispatches, stock entries, low-level changes. */
export function afterStockChange(user: SessionUser) {
  later("low stock", async () => checkLowStock(db, await webPushSender(), user.companyId, user.userId));
}

export function afterDispatch(user: SessionUser, partyId: string, lines: { itemId: string; unit?: string | null }[], increasedKeys?: Set<string>) {
  later("over stock", async () =>
    checkOverStock(db, await webPushSender(), { companyId: user.companyId, actorId: user.userId, actorName: user.name, partyId }, lines, increasedKeys),
  );
  afterStockChange(user);
}

/** Staff created / changed / cancelled something: owners hear about it. Owners' own actions don't alert. */
export function afterStaffAction(user: SessionUser, ev: StaffEvent) {
  if (user.role !== "staff") return;
  later("staff activity", async () => notifyStaffActivity(db, await webPushSender(), user, ev));
}

/** Picked suggestions become extra names (see masters/learn.ts). */
export function afterLearn(user: SessionUser, picks: Pick[]) {
  if (picks.length) later("learn names", () => learnAliases(db, ctxFor(user), picks));
}
