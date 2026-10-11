import { db } from "@/db/client";
import { LoginFailure, requestCode } from "@/auth/login";
import { otpProvider } from "@/auth/otp-provider";
import { fail, json } from "@/lib/api";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { phone?: string; accessCode?: string };
  try {
    const r = await requestCode(db, otpProvider(), { phone: body.phone ?? "", accessCode: body.accessCode }, {
      // While codes are shown on screen (no SMS yet), a shared access code keeps strangers out.
      requiredAccessCode: process.env.OTP_DEV_MODE === "true" ? process.env.TEST_ACCESS_CODE || undefined : undefined,
    });
    return json({ ok: true, phone: r.phone, devCode: r.showCode });
  } catch (e) {
    if (e instanceof LoginFailure) return fail(e.code, e.code === "TOO_MANY_REQUESTS" ? 429 : 400);
    throw e;
  }
}
