/**
 * Phone + one-time code login. Framework-free so it can be tested directly.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { companies, otpChallenges, sessions, users } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { hmac, hmacEquals, newOtpCode, newToken } from "./crypto";
import type { OtpProvider } from "./otp-provider";

export const OTP_TTL_MS = 10 * 60_000;
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 90 * 24 * 3600_000; // phones stay logged in

export type LoginError =
  | "INVALID_PHONE"
  | "NOT_REGISTERED"
  | "TOO_MANY_REQUESTS"
  | "ACCESS_CODE"
  | "CODE_EXPIRED"
  | "CODE_WRONG"
  | "TOO_MANY_ATTEMPTS"
  | "CHOOSE_COMPANY";

export class LoginFailure extends Error {
  constructor(
    public code: LoginError,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function activeMemberships(db: Db, phone: string) {
  return db
    .select({ userId: users.id, companyId: users.companyId, companyName: companies.name, name: users.name, role: users.role })
    .from(users)
    .innerJoin(companies, eq(companies.id, users.companyId))
    .where(and(eq(users.phone, phone), eq(users.active, true)));
}

export async function requestCode(
  db: Db,
  provider: OtpProvider,
  input: { phone: string; accessCode?: string },
  opts: { requiredAccessCode?: string; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  if (opts.requiredAccessCode && input.accessCode !== opts.requiredAccessCode) throw new LoginFailure("ACCESS_CODE");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new LoginFailure("INVALID_PHONE");
  if (!(await activeMemberships(db, phone)).length) throw new LoginFailure("NOT_REGISTERED");

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(otpChallenges)
    .where(and(eq(otpChallenges.phone, phone), gt(otpChallenges.createdAt, new Date(now.getTime() - 3600_000))));
  if (n >= MAX_SENDS_PER_HOUR) throw new LoginFailure("TOO_MANY_REQUESTS");

  const code = newOtpCode();
  await db.insert(otpChallenges).values({ phone, codeHash: hmac(`${phone}:${code}`), expiresAt: new Date(now.getTime() + OTP_TTL_MS), createdAt: now });
  const { showCode } = await provider.send(phone, code);
  return { phone, showCode };
}

/** Checks the code and opens a session. Returns the raw session token for the cookie. */
export async function verifyCode(db: Db, input: { phone: string; code: string; companyId?: string }, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const phone = normalizePhone(input.phone);
  if (!phone) throw new LoginFailure("INVALID_PHONE");

  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(eq(otpChallenges.phone, phone))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);
  // Only the latest code counts; a newer request replaces older codes.
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) throw new LoginFailure("CODE_EXPIRED");
  if (challenge.attempts >= MAX_ATTEMPTS) throw new LoginFailure("TOO_MANY_ATTEMPTS");
  if (!hmacEquals(`${phone}:${input.code.trim()}`, challenge.codeHash)) {
    await db.update(otpChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(otpChallenges.id, challenge.id));
    throw new LoginFailure(challenge.attempts + 1 >= MAX_ATTEMPTS ? "TOO_MANY_ATTEMPTS" : "CODE_WRONG");
  }

  const memberships = await activeMemberships(db, phone);
  if (!memberships.length) throw new LoginFailure("NOT_REGISTERED");
  const member = input.companyId ? memberships.find((m) => m.companyId === input.companyId) : memberships.length === 1 ? memberships[0] : undefined;
  if (!member) {
    // Same person in several businesses: ask which one, without using up the code.
    throw new LoginFailure("CHOOSE_COMPANY", { companies: memberships.map((m) => ({ id: m.companyId, name: m.companyName })) });
  }

  await db.update(otpChallenges).set({ consumedAt: now }).where(eq(otpChallenges.id, challenge.id));
  const token = newToken();
  await db.insert(sessions).values({
    tokenHash: hmac(token),
    userId: member.userId,
    companyId: member.companyId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
    lastSeenAt: now,
  });
  return { token, userId: member.userId, companyId: member.companyId };
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  companyId: string;
  companyName: string;
  name: string;
  phone: string;
  role: "owner" | "staff" | "viewer";
  language: "hi" | "en";
  /** Gets the daily "maal add kiya?" reminder. */
  stockKeeper: boolean;
  /** Firm whose items and stock this firm uses: its own id unless it shares another firm's godown. */
  stockId: string;
}

export async function userForToken(db: Db, token: string, now = new Date()): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      companyId: users.companyId,
      companyName: companies.name,
      stockCompanyId: companies.stockCompanyId,
      name: users.name,
      phone: users.phone,
      role: users.role,
      language: users.language,
      active: users.active,
      stockKeeper: users.stockKeeper,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(companies, eq(companies.id, users.companyId))
    .where(eq(sessions.tokenHash, hmac(token)));
  if (!row || row.revokedAt || row.expiresAt <= now || !row.active) return null;
  // Touch at most hourly to keep writes low.
  if (now.getTime() - row.lastSeenAt.getTime() > 3600_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    companyId: row.companyId,
    companyName: row.companyName,
    name: row.name,
    phone: row.phone,
    role: row.role,
    language: row.language,
    stockKeeper: row.stockKeeper,
    stockId: row.stockCompanyId ?? row.companyId,
  };
}

export async function revokeSession(db: Db, token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hmac(token)));
}
