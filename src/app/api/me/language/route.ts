import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { fail, json, withUser, readJson } from "@/lib/api";

export async function POST(req: Request) {
  return withUser(async (user) => {
    const { language } = (await readJson(req)) as { language?: string };
    if (language !== "hi" && language !== "en") return fail("INVALID_LANGUAGE");
    await db.update(users).set({ language }).where(eq(users.id, user.userId));
    return json({ ok: true });
  });
}
