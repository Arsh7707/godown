/**
 * Sends each capture to the cheapest model that handles it well:
 * - photos of slips/challans (handwriting, strike-outs) → complex model
 * - typed text and voice transcripts → simple model, escalating to the
 *   complex model when the simple one can't read part of it or fails.
 */
import type { ModelOutput } from "./schema";
import { ExtractionError, type Extractor, type ExtractorRequest } from "./types";

export type Route = "simple" | "complex" | "escalated";

/** The simple model's answer is not trustworthy enough to show as-is. */
export function needsEscalation(out: ModelOutput): boolean {
  if (!out.is_relevant) return false;
  return (
    out.unreadable.length > 0 ||
    out.entries.length === 0 ||
    out.entries.some((e) => e.lines.length === 0 || e.lines.some((l) => l.quantity === null))
  );
}

export class RoutingExtractor implements Extractor {
  constructor(
    private simple: Extractor,
    private complex: Extractor,
    private onRoute?: (route: Route) => void,
  ) {}

  async extract(req: ExtractorRequest, signal: AbortSignal): Promise<ModelOutput> {
    if (req.image) {
      this.onRoute?.("complex");
      return this.complex.extract(req, signal);
    }
    try {
      const out = await this.simple.extract(req, signal);
      if (!needsEscalation(out)) {
        this.onRoute?.("simple");
        return out;
      }
    } catch (e) {
      // Out of time or not configured: a second model won't help.
      if (e instanceof ExtractionError && (e.reason === "timeout" || e.reason === "not_configured")) throw e;
    }
    this.onRoute?.("escalated");
    return this.complex.extract(req, signal);
  }
}
