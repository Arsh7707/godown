import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return s;
}

/** Keyed hash so a database leak does not reveal codes or session tokens. */
export function hmac(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function hmacEquals(value: string, hash: string): boolean {
  const a = Buffer.from(hmac(value), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const newToken = () => randomBytes(32).toString("base64url");
export const newOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
