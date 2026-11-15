/**
 * What goes to Sarvam, against a stand-in for its API (nothing is really sent).
 * It refuses the whole voice note if the names to listen for break its rules.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SarvamTranscriber } from "@/extraction/sarvam";
import { encodeWav, splitWav } from "@/lib/wav";

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

  it("names that differ only by spaces or punctuation count as one", async () => {
    expect(await listen(["D-4012", "D 4012", "d4012", "Cotton Poplin · White", "Cotton Poplin White", "---"])).toEqual(["D-4012", "Cotton Poplin · White"]);
  });

  it("if Sarvam still refuses the names, the note is read without them", async () => {
    const sent: (string | null)[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const k = (init.body as FormData).get("keyterms") as string | null;
      sent.push(k);
      if (k) return new Response(JSON.stringify({ error: { message: "Keyterms must not contain duplicates." } }), { status: 400 });
      return new Response(JSON.stringify({ transcript: "दो डब्बे", language_code: "hi-IN" }), { status: 200 });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await new SarvamTranscriber("KEY", "saaras:v4", "unknown").transcribe({ data: Buffer.from("x"), mimeType: "audio/mp4" }, { keyterms: ["Sharma"], signal: AbortSignal.timeout(1000) });
    expect(r.text).toBe("दो डब्बे");
    expect(sent).toEqual(['["Sharma"]', null]);
    warn.mockRestore();
  });

  it("other refusals still fail the note", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad audio", { status: 400 }));
    await expect(new SarvamTranscriber("KEY", "saaras:v4", "unknown").transcribe({ data: Buffer.from("x"), mimeType: "audio/mp4" }, { keyterms: ["Sharma"], signal: AbortSignal.timeout(1000) })).rejects.toThrow(/Sarvam 400/);
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

describe("long voice notes", () => {
  /** Each request answers with the piece's length, so the joined text shows the order. */
  function fakeSarvamByLength() {
    const calls: { type: string; keyterms: string | null }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const file = form.get("file") as Blob;
      calls.push({ type: file.type, keyterms: form.get("keyterms") as string | null });
      const secs = Math.round((file.size - 44) / 2 / 16_000);
      await new Promise((r) => setTimeout(r, (30 - secs) * 2)); // later pieces can finish first
      return new Response(JSON.stringify({ transcript: `part-${secs}s`, language_code: "hi-IN" }), { status: 200 });
    });
    return calls;
  }
  const sarvam = () => new SarvamTranscriber("KEY", "saaras:v4", "unknown");
  const wavOf = (secs: number) => Buffer.from(encodeWav(new Float32Array(secs * 16_000).map((_, i) => 0.5 * Math.sin(i / 10))));

  it("sends a long WAV in pieces and joins the text in order", async () => {
    const calls = fakeSarvamByLength();
    const data = wavOf(60);
    const r = await sarvam().transcribe({ data, mimeType: "audio/wav" }, { keyterms: ["Sharma"], signal: AbortSignal.timeout(5000) });
    const pieces = splitWav(data);
    expect(pieces).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.type === "audio/wav" && c.keyterms === '["Sharma"]')).toBe(true);
    const expected = pieces.map((p) => `part-${Math.round((p.length - 44) / 2 / 16_000)}s`).join(" ");
    expect(r).toEqual({ text: expected, languageCode: "hi-IN" });
  });

  it("sends a short note once, as recorded", async () => {
    const calls = fakeSarvamByLength();
    await sarvam().transcribe({ data: wavOf(10), mimeType: "audio/wav" }, { signal: AbortSignal.timeout(5000) });
    expect(calls).toHaveLength(1);
  });

  it("fails the note if any piece fails", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (++n === 2 ? new Response("busy", { status: 500 }) : new Response(JSON.stringify({ transcript: "x" }))));
    await expect(sarvam().transcribe({ data: wavOf(60), mimeType: "audio/wav" }, { signal: AbortSignal.timeout(5000) })).rejects.toThrow(/Sarvam 500/);
  });
});
