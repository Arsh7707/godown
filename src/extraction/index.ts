export { runExtraction, type PipelineDeps, type PipelineInput } from "./pipeline";
export { loadCatalog } from "./catalog";
export { ClaudeExtractor, ClaudeModel } from "./claude";
export { RoutingExtractor, type Route } from "./routing";
export { SarvamTranscriber } from "./sarvam";
export type * from "./types";

import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeExtractor, ClaudeModel, type Effort, type UsageHook } from "./claude";
import { RoutingExtractor, type Route } from "./routing";
import { SarvamTranscriber } from "./sarvam";
import type { PipelineDeps } from "./pipeline";

const env = (k: string) => process.env[k] || undefined;

/**
 * Production wiring.
 * EXTRACTION_MODEL_SIMPLE (typed text, voice transcripts), e.g. claude-haiku-4-5
 * EXTRACTION_MODEL_COMPLEX (slip photos, and anything the simple model can't read), e.g. claude-sonnet-5-5
 * EXTRACTION_EFFORT_SIMPLE / EXTRACTION_EFFORT_COMPLEX: optional; leave the simple one unset for Haiku, which rejects it.
 */
export function claudeModels(hooks: { onUsage?: UsageHook } = {}) {
  return {
    simple: new ClaudeModel({ model: env("EXTRACTION_MODEL_SIMPLE"), effort: env("EXTRACTION_EFFORT_SIMPLE") as Effort | undefined, onUsage: hooks.onUsage }),
    complex: new ClaudeModel({ model: env("EXTRACTION_MODEL_COMPLEX"), effort: env("EXTRACTION_EFFORT_COMPLEX") as Effort | undefined, onUsage: hooks.onUsage }),
  };
}

export function defaultDeps(hooks: { onUsage?: (u: Anthropic.Usage, model: string) => void; onRoute?: (r: Route) => void } = {}): PipelineDeps {
  const simple = new ClaudeExtractor({
    model: env("EXTRACTION_MODEL_SIMPLE"),
    effort: env("EXTRACTION_EFFORT_SIMPLE") as Effort | undefined,
    onUsage: hooks.onUsage,
  });
  const complex = new ClaudeExtractor({
    model: env("EXTRACTION_MODEL_COMPLEX"),
    effort: env("EXTRACTION_EFFORT_COMPLEX") as Effort | undefined,
    onUsage: hooks.onUsage,
  });
  return {
    extractor: new RoutingExtractor(simple, complex, hooks.onRoute),
    transcriber: new SarvamTranscriber(),
    timeoutMs: Number(env("EXTRACTION_TIMEOUT_MS") ?? 45_000),
  };
}
