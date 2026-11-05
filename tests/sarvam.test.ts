/**
 * What goes to Sarvam, against a stand-in for its API (nothing is really sent).
 * It refuses the whole voice note if the names to listen for break its rules.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SarvamTranscriber } from "@/extraction/sarvam";

/** Answers like Sarvam and hands back the keyterms it was sent. */
function fakeSarvam() {
  const sent: (string[] | null)[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const k = (init.body as FormData).get("keyterms");
    sent.push(k ? JSON.parse(String(k)) : null);
    return new Response(JSON.stringify({ transcript: "दो डब्बे", language_code: "hi-IN" }), { status: 200 });
  });
  return sent;
}
const listen = async (keyterms: string[]) => {
  const sent = fakeSarvam();
  await new SarvamTranscriber("KEY", "saaras:v4", "unknown").transcribe({ data: Buffer.from("x"), mimeType: "audio/mp4" }, { keyterms, signal: AbortSignal.timeout(1000) });
  return sent[0];
};

afterEach(() => vi.unstubAllGlobals());

describe("names sent to Sarvam", () => {
  it("never repeats a name: same words, other capitals or spaces, or a party and item sharing one", async () => {
    expect(await listen(["Sharma", "D-4012", "Sharma", "sharma", " SHARMA ", "शर्मा", "शर्मा"])).toEqual(["Sharma", "D-4012", "शर्मा"]);
  });

  it("leaves out blanks and names over 64 characters", async () => {
    expect(await listen(["Gupta", "", "   ", "x".repeat(65), "y".repeat(64)])).toEqual(["Gupta", "y".repeat(64)]);
  });

  it("repeats don't use up the 50 places", async () => {
    const many = Array.from({ length: 60 }, (_, i) => `Name ${i}`);
    const got = await listen([...many.slice(0, 10), ...many.slice(0, 10), ...many.slice(10)]);
    expect(got).toEqual(many.slice(0, 50));
  });

  it("sends no list when there are no names", async () => {
    expect(await listen(["", " "])).toBeNull();
  });
});
