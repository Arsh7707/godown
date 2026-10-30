import { db } from "@/db/client";
import { LoginFailure, requestCode } from "@/auth/login";
import { otpProvider } from "@/auth/otp-provider";
import { fail, json, readJson } from "@/lib/api";

export async function POST(req: Request) {
  const body = (await readJson(req)) as { phone?: string; accessCode?: string };
  try {
    const r = await requestCode(db, otpProvider(), { phone: String(body.phone ?? ""), accessCode: typeof body.accessCode === "string" ? body.accessCode : undefined }, {
      // While codes are shown on screen (testing), a shared access code keeps strangers out.
      requiredAccessCode: process.env.OTP_DEV_MODE === "true" ? process.env.TEST_ACCESS_CODE || undefined : undefined,
    });
    return json({ ok: true, phone: r.phone, devCode: r.showCode, channel: r.channel });
  } catch (e) {
    if (e instanceof LoginFailure) return fail(e.code, e.code === "TOO_MANY_REQUESTS" ? 429 : e.code === "SEND_FAILED" ? 503 : 400);
    throw e;
  }
}
