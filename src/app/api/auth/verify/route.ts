import { db } from "@/db/client";
import { LoginFailure, verifyCode } from "@/auth/login";
import { setSessionCookie } from "@/auth/session";
import { fail, json } from "@/lib/api";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { phone?: string; code?: string; companyId?: string };
  try {
    const r = await verifyCode(db, { phone: body.phone ?? "", code: body.code ?? "", companyId: body.companyId });
    await setSessionCookie(r.token);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof LoginFailure) return fail(e.code, 400, e.extra);
    throw e;
  }
}
