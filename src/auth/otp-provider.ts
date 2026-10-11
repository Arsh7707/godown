/**
 * Sends login codes. Swap the implementation for a real SMS provider
 * without touching the login flow.
 */
export interface OtpProvider {
  /** Delivers the code. Returns the code only if it should be shown on screen (dev mode). */
  send(phone: string, code: string): Promise<{ showCode: string | null }>;
}

/** Testing only: no SMS is sent, the code is shown on the login screen. */
export class DevOtpProvider implements OtpProvider {
  async send(_phone: string, code: string) {
    return { showCode: code };
  }
}

export function otpProvider(): OtpProvider {
  if (process.env.OTP_DEV_MODE === "true") return new DevOtpProvider();
  throw new Error("No SMS provider configured. Set OTP_DEV_MODE=true for testing.");
}
