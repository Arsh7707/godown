import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { DevOtpProvider } from "@/auth/otp-provider";
import { MAX_SENDS_PER_HOUR, requestCode, revokeSession, userForToken, verifyCode } from "@/auth/login";
import { freshDb, makeCompany } from "./helpers";

describe("phone numbers", () => {
  it("normalises Indian and international numbers", () => {
    expect(normalizePhone("9215622330")).toBe("+919215622330");
    expect(normalizePhone("092156 22330")).toBe("+919215622330");
    expect(normalizePhone("+91 92156-22330")).toBe("+919215622330");
    expect(normalizePhone("919215622330")).toBe("+919215622330");
    expect(normalizePhone("+1 437 210 4659")).toBe("+14372104659");
    expect(normalizePhone("4372104659")).toBeNull(); // not Indian, no country code: ambiguous
    expect(normalizePhone("12345")).toBeNull();
    expect(formatPhone("+919215622330")).toBe("+91 92156 22330");
    expect(formatPhone("+14372104659")).toBe("+1 437-210-4659");
  });
});

describe("OTP login", () => {
  let db: Db;
  let co: Awaited<ReturnType<typeof makeCompany>>;
  const dev = new DevOtpProvider();
  const OWNER = "+919800000001";

  beforeEach(async () => {
    db = await freshDb();
    co = await makeCompany(db);
  });

  it("logs in with the shown code and opens a session", async () => {
    const { showCode } = await requestCode(db, dev, { phone: "9800000001" });
    expect(showCode).toMatch(/^\d{6}$/);
    const { token, companyId } = await verifyCode(db, { phone: OWNER, code: showCode! });
    expect(companyId).toBe(co.company.id);
    expect(await userForToken(db, token)).toMatchObject({ companyId: co.company.id, role: "owner", phone: OWNER });
  });

  it("stores only hashes", async () => {
    const { showCode } = await requestCode(db, dev, { phone: OWNER });
    const [c] = await db.select().from(s.otpChallenges);
    expect(c.codeHash).not.toContain(showCode!);
    const { token } = await verifyCode(db, { phone: OWNER, code: showCode! });
    const [sess] = await db.select().from(s.sessions);
    expect(sess.tokenHash).not.toBe(token);
  });

  it("refuses unknown numbers, bad numbers and a wrong access code", async () => {
    await expect(requestCode(db, dev, { phone: "9999999999" })).rejects.toMatchObject({ code: "NOT_REGISTERED" });
    await expect(requestCode(db, dev, { phone: "123" })).rejects.toMatchObject({ code: "INVALID_PHONE" });
    await expect(requestCode(db, dev, { phone: OWNER, accessCode: "nope" }, { requiredAccessCode: "family" })).rejects.toMatchObject({ code: "ACCESS_CODE" });
    await expect(requestCode(db, dev, { phone: OWNER, accessCode: "family" }, { requiredAccessCode: "family" })).resolves.toBeTruthy();
  });

  it("limits code requests per hour", async () => {
    for (let i = 0; i < MAX_SENDS_PER_HOUR; i++) await requestCode(db, dev, { phone: OWNER });
    await expect(requestCode(db, dev, { phone: OWNER })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    const later = new Date(Date.now() + 61 * 60_000);
    await expect(requestCode(db, dev, { phone: OWNER }, { now: later })).resolves.toBeTruthy();
  });

  it("locks the code after 5 wrong tries, and a code works only once", async () => {
    const { showCode } = await requestCode(db, dev, { phone: OWNER });
    const wrong = showCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await expect(verifyCode(db, { phone: OWNER, code: wrong })).rejects.toMatchObject({ code: "CODE_WRONG" });
    await expect(verifyCode(db, { phone: OWNER, code: wrong })).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    await expect(verifyCode(db, { phone: OWNER, code: showCode! })).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });

    const second = await requestCode(db, dev, { phone: OWNER });
    await verifyCode(db, { phone: OWNER, code: second.showCode! });
    await expect(verifyCode(db, { phone: OWNER, code: second.showCode! })).rejects.toMatchObject({ code: "CODE_EXPIRED" });
  });

  it("expires codes after 10 minutes", async () => {
    const { showCode } = await requestCode(db, dev, { phone: OWNER });
    await expect(verifyCode(db, { phone: OWNER, code: showCode! }, { now: new Date(Date.now() + 11 * 60_000) })).rejects.toMatchObject({ code: "CODE_EXPIRED" });
  });

  it("asks which business when one phone belongs to two", async () => {
    const other = await makeCompany(db, "Other Co"); // same seeded phone numbers
    const { showCode } = await requestCode(db, dev, { phone: OWNER });
    const err = await verifyCode(db, { phone: OWNER, code: showCode! }).catch((e) => e);
    expect(err).toMatchObject({ code: "CHOOSE_COMPANY" });
    expect(err.extra.companies.map((c: { name: string }) => c.name).sort()).toEqual(["Other Co", "Test Textiles"]);
    // The code still works once a business is chosen.
    const r = await verifyCode(db, { phone: OWNER, code: showCode!, companyId: other.company.id });
    expect(r.companyId).toBe(other.company.id);
  });

  it("ends sessions on logout and for deactivated users", async () => {
    const { showCode } = await requestCode(db, dev, { phone: OWNER });
    const { token } = await verifyCode(db, { phone: OWNER, code: showCode! });
    await revokeSession(db, token);
    expect(await userForToken(db, token)).toBeNull();

    const again = await requestCode(db, dev, { phone: OWNER });
    const { token: t2 } = await verifyCode(db, { phone: OWNER, code: again.showCode! });
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, co.owner.userId));
    expect(await userForToken(db, t2)).toBeNull();
    expect(await userForToken(db, "not-a-token")).toBeNull();
  });
});
