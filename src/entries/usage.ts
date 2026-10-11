import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db/client";
import { aiUsage } from "@/db/schema";

// $ per million tokens [input, output]; cache reads 0.1x input, writes 1.25x.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};
const SARVAM_USD_PER_HOUR = Number(process.env.SARVAM_USD_PER_HOUR ?? 0.35);

export function claudeCostMicroUsd(u: Anthropic.Usage, model: string): number {
  const [i, o] = PRICES[model] ?? [4, 20];
  return Math.round(
    u.input_tokens * i + (u.cache_creation_input_tokens ?? 0) * i * 1.25 + (u.cache_read_input_tokens ?? 0) * i * 0.1 + u.output_tokens * o,
  );
}

export async function recordClaudeUsage(companyId: string, userId: string, captureId: string, u: Anthropic.Usage, model: string) {
  await db.insert(aiUsage).values({
    companyId,
    userId,
    captureId,
    provider: "anthropic",
    model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    costMicroUsd: claudeCostMicroUsd(u, model),
  });
}

export async function recordSpeechUsage(companyId: string, userId: string, captureId: string, seconds: number) {
  await db.insert(aiUsage).values({
    companyId,
    userId,
    captureId,
    provider: "sarvam",
    model: process.env.SARVAM_STT_MODEL ?? "saaras:v4",
    audioSeconds: seconds.toFixed(2),
    costMicroUsd: Math.round((seconds / 3600) * SARVAM_USD_PER_HOUR * 1e6),
  });
}

/** Cost safety net: stop AI reading for a company after N captures in 24h (typing the form always works). */
export async function overDailyLimit(companyId: string): Promise<boolean> {
  const limit = Number(process.env.AI_DAILY_CAPTURE_LIMIT ?? 500);
  const [{ n }] = await db
    .select({ n: sql<number>`count(distinct ${aiUsage.captureId})::int` })
    .from(aiUsage)
    .where(and(eq(aiUsage.companyId, companyId), gt(aiUsage.createdAt, new Date(Date.now() - 24 * 3600_000))));
  return n >= limit;
}
