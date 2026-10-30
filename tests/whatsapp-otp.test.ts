/**
 * Login codes over WhatsApp, against a stand-in for Meta's API (nothing is
 * really sent): the request is exactly what Meta expects, failures become
 * clear messages, and a failed send never uses up the hourly limit.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { DevOtpProvider, OtpSendError, WhatsAppOtpProvider, otpProvider } from "@/auth/otp-provider";
import { LoginFailure, MAX_SENDS_PER_HOUR, requestCode, verifyCode } from "@/auth/login";
import { freshDb, makeCompany } from "./helpers";

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

/** A fake Meta: answers each call with the next reply (status + body) and records the requests. */
function fakeMeta(...replies: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)] ?? { status: 200 };
    return new Response(JSON.stringify(r.body ?? { messages: [{ id: "wamid.X" }] }), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}
const metaError = (code: number, message = "error") => ({ status: 400, body: { error: { message, type: "OAuthException", code, error_data: { messaging_product: "whatsapp", details: message }, fbtrace_id: "T" } } });
const provider = (f: typeof fetch) => new WhatsAppOtpProvider({ token: "TEST-TOKEN", phoneNumberId: "1059545", template: "login_code", apiVersion: "v26.0", fetch: f });

describe("WhatsApp login codes", () => {
  it("sends Meta's authentication template: code in the body and on the Copy code button", async () => {
    const meta = fakeMeta({ status: 200 });
    expect(await provider(meta.f).send("+919800000001", "482913", { language: "en" })).toEqual({ showCode: null });
    expect(meta.calls).toHaveLength(1);
    const [c] = meta.calls;
    expect(c.url).toBe("https://graph.facebook.com/v26.0/1059545/messages");
    expect(c.init.method).toBe("POST");
    expect((c.init.headers as Record<string, string>).authorization).toBe("Bearer TEST-TOKEN");
    expect(c.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919800000001",
      type: "template",
      template: {
        name: "login_code",
        language: { code: "en" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "482913" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
        ],
      },
    });
  });

  it("sends Hindi users the Hindi template, and English if the Hindi one isn't approved", async () => {
    const ok = fakeMeta({ status: 200 });
    await provider(ok.f).send("+919800000001", "111111", { language: "hi" });
    expect((ok.calls[0].body.template as { language: { code: string } }).language.code).toBe("hi");

    const noHindi = fakeMeta(metaError(132001, "Template name does not exist in the translation"), { status: 200 });
    await provider(noHindi.f).send("+919800000001", "111111", { language: "hi" });
    expect(noHindi.calls.map((c) => (c.body.template as { language: { code: string } }).language.code)).toEqual(["hi", "en"]);
  });

  it("sorts Meta's errors into what to tell the person", async () => {
    const reason = async (...replies: Parameters<typeof fakeMeta>) =>
      provider(fakeMeta(...replies).f)
        .send("+919800000001", "1", { language: "en" })
        .then(
          () => "sent",
          (e) => (e instanceof OtpSendError ? e.reason : `other: ${e}`),
        );
    expect(await reason(metaError(131026, "Message undeliverable"))).toBe("notOnWhatsApp");
    expect(await reason(metaError(130429, "Rate limit hit"))).toBe("busy");
    expect(await reason(metaError(131056, "Pair rate limit hit"))).toBe("busy");
    expect(await reason(metaError(190, "Access token has expired"))).toBe("setup");
    expect(await reason(metaError(132001, "Template does not exist"))).toBe("setup");
    expect(await reason({ status: 500, body: "not json" })).toBe("busy");
    const offline = new WhatsAppOtpProvider({ token: "T", phoneNumberId: "1", template: "t", apiVersion: "v26.0", fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch });
    expect(await offline.send("+919800000001", "1").catch((e) => e.reason)).toBe("busy");
  });

  it("the token never appears in an error message", async () => {
    const err = await provider(fakeMeta(metaError(190, "Invalid OAuth access token")).f)
      .send("+919800000001", "1")
      .catch((e) => e as Error);
    expect(String((err as Error).message)).not.toContain("TEST-TOKEN");
  });

  it("picks the way codes go from the settings", () => {
    expect(otpProvider({ OTP_DEV_MODE: "true", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" })).toBeInstanceOf(DevOtpProvider);
    expect(otpProvider({ WHATSAPP_ACCESS_TOKEN: " t ", WHATSAPP_PHONE_NUMBER_ID: "1" })).toBeInstanceOf(WhatsAppOtpProvider);
    expect(otpProvider({ WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" }).channel).toBe("whatsapp");
    expect(() => otpProvider({ WHATSAPP_ACCESS_TOKEN: "t" })).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
    expect(() => otpProvider({})).toThrow(/OTP_DEV_MODE/);
  });
});

describe("logging in with WhatsApp codes", () => {
  let db: Db;
  const OWNER = "+919800000001";
  beforeEach(async () => {
    db = await freshDb();
    await makeCompany(db);
  });

  it("the code that went on WhatsApp logs you in; nothing is shown on screen", async () => {
    const meta = fakeMeta({ status: 200 });
    const r = await requestCode(db, provider(meta.f), { phone: "9800000001" });
    expect(r).toMatchObject({ phone: OWNER, showCode: null, channel: "whatsapp" });
    const sent = (meta.calls[0].body.template as { components: { parameters: { text: string }[] }[] }).components[0].parameters[0].text;
    expect(sent).toMatch(/^\d{6}$/);
    expect((await verifyCode(db, { phone: OWNER, code: sent })).token).toBeTruthy();
  });

  it("sends the code in the user's language", async () => {
    await db.update(s.users).set({ language: "en" }).where(eq(s.users.phone, OWNER));
    const meta = fakeMeta({ status: 200 });
    await requestCode(db, provider(meta.f), { phone: OWNER });
    expect((meta.calls[0].body.template as { language: { code: string } }).language.code).toBe("en");
  });

  it("a number without WhatsApp is told so, and failed sends don't use up the hourly limit", async () => {
    const meta = fakeMeta(metaError(131026, "Message undeliverable"));
    for (let i = 0; i < MAX_SENDS_PER_HOUR + 2; i++) {
      const e = await requestCode(db, provider(meta.f), { phone: OWNER }).catch((x) => x);
      expect(e).toBeInstanceOf(LoginFailure);
      expect((e as LoginFailure).code).toBe("NOT_ON_WHATSAPP");
    }
    expect(await db.select().from(s.otpChallenges)).toHaveLength(0);
    // Once WhatsApp works, the person can still log in straight away.
    expect((await requestCode(db, new DevOtpProvider(), { phone: OWNER })).showCode).toMatch(/^\d{6}$/);
  });

  it("Meta busy or the setup broken: 'try again', and no code is left waiting", async () => {
    for (const err of [metaError(130429), metaError(190)]) {
      const e = await requestCode(db, provider(fakeMeta(err).f), { phone: OWNER }).catch((x) => x);
      expect((e as LoginFailure).code).toBe("SEND_FAILED");
    }
    expect(await db.select().from(s.otpChallenges)).toHaveLength(0);
  });

  it("a code that failed to send can't be used", async () => {
    await requestCode(db, provider(fakeMeta(metaError(131026)).f), { phone: OWNER }).catch(() => {});
    await expect(verifyCode(db, { phone: OWNER, code: "000000" })).rejects.toMatchObject({ code: "CODE_EXPIRED" });
  });
});
