/**
 * Sends login codes. The login flow only sees this interface, so the way
 * codes travel (on screen while testing, WhatsApp in use) can change
 * without touching it.
 */
export type OtpChannel = "screen" | "whatsapp";

export interface OtpProvider {
  readonly channel: OtpChannel;
  /** Delivers the code. Returns the code only if it should be shown on screen (dev mode). */
  send(phone: string, code: string, opts?: { language?: "hi" | "en" }): Promise<{ showCode: string | null }>;
}

/**
 * The code could not be sent. `notOnWhatsApp`: the number has no WhatsApp;
 * `busy`: too many messages just now, try again shortly; `setup`: the
 * WhatsApp account, token or template needs fixing (the owner's job, logged).
 */
export class OtpSendError extends Error {
  constructor(
    public reason: "notOnWhatsApp" | "busy" | "setup",
    detail: string,
  ) {
    super(detail);
  }
}

/** Testing only: nothing is sent, the code is shown on the login screen. */
export class DevOtpProvider implements OtpProvider {
  readonly channel = "screen" as const;
  async send(_phone: string, code: string) {
    return { showCode: code };
  }
}

export interface WhatsAppConfig {
  /** Permanent access token of a system user with whatsapp_business_messaging. */
  token: string;
  /** The business phone number's ID (not the number itself), from WhatsApp Manager. */
  phoneNumberId: string;
  /** Name of the approved AUTHENTICATION template with a copy-code button. */
  template: string;
  apiVersion: string;
  fetch?: typeof fetch;
}

/** Meta error codes, sorted into what the person logging in should hear. */
const NOT_ON_WHATSAPP = new Set([131026]);
const BUSY = new Set([4, 80007, 130429, 131048, 131056]);
const TEMPLATE_LANGUAGE_MISSING = 132001;

/**
 * Login codes over WhatsApp (Meta's Cloud API), as an authentication
 * template: "123456 is your verification code" with a Copy code button.
 * Hindi users get the Hindi version of the template when it exists,
 * otherwise English.
 */
export class WhatsAppOtpProvider implements OtpProvider {
  readonly channel = "whatsapp" as const;
  constructor(private cfg: WhatsAppConfig) {}

  async send(phone: string, code: string, opts: { language?: "hi" | "en" } = {}) {
    const first = opts.language === "hi" ? "hi" : "en";
    const r = await this.post(phone, code, first);
    // The Hindi template may not be approved (yet): English rather than no code at all.
    if (!r.ok && r.code === TEMPLATE_LANGUAGE_MISSING && first !== "en") {
      const again = await this.post(phone, code, "en");
      if (again.ok) return { showCode: null };
      throw this.failure(again);
    }
    if (!r.ok) throw this.failure(r);
    return { showCode: null };
  }

  private async post(phone: string, code: string, language: string): Promise<{ ok: true } | { ok: false; code: number | null; detail: string }> {
    const f = this.cfg.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.token}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone.replace(/^\+/, ""),
          type: "template",
          template: {
            name: this.cfg.template,
            language: { code: language },
            components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
            ],
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { ok: false, code: null, detail: `network: ${(e as Error).message}` };
    }
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: { code?: number; message?: string; error_data?: { details?: string } } } | null;
    const err = body?.error;
    return { ok: false, code: typeof err?.code === "number" ? err.code : null, detail: `HTTP ${res.status} ${err?.code ?? ""} ${err?.message ?? ""} ${err?.error_data?.details ?? ""}`.trim() };
  }

  private failure(r: { code: number | null; detail: string }) {
    if (r.code !== null && NOT_ON_WHATSAPP.has(r.code)) return new OtpSendError("notOnWhatsApp", r.detail);
    if (r.code === null || BUSY.has(r.code)) return new OtpSendError("busy", r.detail);
    return new OtpSendError("setup", r.detail);
  }
}

/**
 * Which way codes go, from the settings:
 * OTP_DEV_MODE=true → shown on screen (testing, previews);
 * WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID → WhatsApp.
 */
export function otpProvider(env: Record<string, string | undefined> = process.env): OtpProvider {
  if (env.OTP_DEV_MODE === "true") return new DevOtpProvider();
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (token && phoneNumberId)
    return new WhatsAppOtpProvider({ token, phoneNumberId, template: env.WHATSAPP_OTP_TEMPLATE?.trim() || "login_code", apiVersion: env.WHATSAPP_API_VERSION?.trim() || "v26.0" });
  throw new Error("No way to send login codes. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID (or OTP_DEV_MODE=true for testing).");
}
