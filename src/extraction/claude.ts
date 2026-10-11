/**
 * Claude calls for one model (see index.ts for which model handles what).
 * Uses structured outputs so every response parses against its schema.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { ModelOutput } from "./schema";
import { ExtractionError, type Extractor, type ExtractorRequest } from "./types";
import { systemPrompt, userText } from "./prompt";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type UsageHook = (u: Anthropic.Usage, model: string) => void;

/** One model, asked for JSON matching a schema. */
export class ClaudeModel {
  private client: Anthropic;
  readonly model: string | undefined;
  private effort: Effort | undefined;
  private onUsage?: UsageHook;

  constructor(opts: { client?: Anthropic; model?: string; effort?: Effort; onUsage?: UsageHook } = {}) {
    // One retry: the user is waiting on a phone; callers have their own overall timeout.
    this.client = opts.client ?? new Anthropic({ maxRetries: 1 });
    this.model = opts.model;
    this.effort = opts.effort;
    this.onUsage = opts.onUsage;
  }

  async json<S extends z.ZodType>(schema: S, system: string, content: Anthropic.ContentBlockParam[], signal: AbortSignal): Promise<z.infer<S>> {
    if (!this.model) throw new ExtractionError("not_configured", "Extraction model is not set (EXTRACTION_MODEL_SIMPLE / EXTRACTION_MODEL_COMPLEX)");
    let response;
    try {
      response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: 16000,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content }],
          output_config: { format: zodOutputFormat(schema), ...(this.effort ? { effort: this.effort } : {}) },
        },
        { signal },
      );
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError) throw new ExtractionError("timeout", "Extraction timed out");
      if (e instanceof Anthropic.AuthenticationError) throw new ExtractionError("not_configured", "Anthropic API key missing or invalid");
      if (e instanceof Anthropic.APIError) throw new ExtractionError("error", `Claude API error ${e.status ?? ""}: ${e.message}`);
      throw new ExtractionError("error", e instanceof Error ? e.message : String(e));
    }

    this.onUsage?.(response.usage, this.model);
    if (response.stop_reason === "refusal") throw new ExtractionError("refused", "The model declined this input");
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new ExtractionError("error", `Incomplete model output (stop_reason: ${response.stop_reason})`);
    }
    return response.parsed_output as z.infer<S>;
  }
}

/** Reads order/dispatch entries from a photo, voice transcript or message. */
export class ClaudeExtractor implements Extractor {
  private m: ClaudeModel;

  constructor(opts: { client?: Anthropic; model?: string; effort?: Effort; onUsage?: UsageHook } = {}) {
    this.m = new ClaudeModel(opts);
  }

  async extract(req: ExtractorRequest, signal: AbortSignal): Promise<ModelOutput> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (req.image) {
      content.push({ type: "image", source: { type: "base64", media_type: req.image.mimeType, data: req.image.data.toString("base64") } });
    }
    content.push({
      type: "text",
      text: userText({ text: req.text, hasImage: !!req.image, today: req.today, weekday: req.weekday, fromVoice: req.fromVoice }),
    });
    return this.m.json(ModelOutput, systemPrompt(req.kind, req.catalog), content, signal);
  }
}
