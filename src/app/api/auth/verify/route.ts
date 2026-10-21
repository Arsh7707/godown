import { db } from "@/db/client";
import { LoginFailure, verifyCode } from "@/auth/login";
import { setSessionCookie } from "@/auth/session";
import { fail, json, readJson } from "@/lib/api";

export async function POST(req: Request) {
  const body = (await readJson(req)) as { phone?: string; code?: string; companyId?: string };
  try {
    const r = await verifyCode(db, { phone: String(body.phone ?? ""), code: String(body.code ?? ""), companyId: typeof body.companyId === "string" ? body.companyId : undefined });
    await setSessionCookie(r.token);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof LoginFailure) return fail(e.code, 400, e.extra);
    throw e;
  }
}
