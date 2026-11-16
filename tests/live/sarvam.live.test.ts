/**
 * Calls the real Sarvam API. Skipped unless SARVAM_API_KEY is set and the
 * Mac's text-to-speech (`say`) is there to make test voice notes.
 *
 *   npm run test:live
 *
 * Costs a few paise of Sarvam credit per run.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SarvamTranscriber } from "@/extraction/sarvam";
import { splitWav } from "@/lib/wav";

const hasSay = (() => {
  try {
    execFileSync("which", ["say", "afconvert"]);
    return true;
  } catch {
    return false;
  }
})();
const live = !!process.env.SARVAM_API_KEY && hasSay;

/** A voice note made by the Mac's speech voice, as 16 kHz WAV (what phones send for long notes). */
function speak(text: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "godown-voice-"));
  const aiff = join(dir, "v.aiff");
  const wav = join(dir, "v.wav");
  const voices = execFileSync("say", ["-v", "?"]).toString();
  const voice = /^Lekha\s/m.test(voices) ? ["-v", "Lekha"] : [];
  execFileSync("say", [...voice, "-o", aiff, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  return readFileSync(wav);
}

const ORDER = "Sharma ji ka order likho. Bees piece D chaar zero ek do, laal rang. Das piece D chaar zero ek teen. Gupta Traders ko pachaas meter cotton poplin bhejna hai.";

describe.skipIf(!live)("live Sarvam speech-to-text", () => {
  const sarvam = new SarvamTranscriber();

  it("reads a short voice note", async () => {
    const r = await sarvam.transcribe({ data: speak(ORDER), mimeType: "audio/wav" }, { keyterms: ["Sharma Cloth House", "Gupta Traders", "D-4012 Suit", "Cotton Poplin"], signal: AbortSignal.timeout(45_000) });
    console.log("short:", r.languageCode, r.text);
    expect(r.text.length).toBeGreaterThan(20);
  }, 60_000);

  it("reads a voice note of nearly a minute, in pieces, start to end", async () => {
    const audio = speak(`${ORDER} ${ORDER} ${ORDER} Aakhri baat: Mehta Fabrics ka purana order cancel karo.`);
    expect(splitWav(audio).length).toBeGreaterThan(1);
    const r = await sarvam.transcribe({ data: audio, mimeType: "audio/wav" }, { signal: AbortSignal.timeout(45_000) });
    console.log("long:", r.text);
    expect(r.text.length).toBeGreaterThan(80);
    expect(r.text.toLowerCase()).toMatch(/mehta|मेहता|cancel|कैंसल/);
  }, 60_000);

  it("never fails over names that look alike", async () => {
    const names = ["D-4012", "D 4012", "d4012", "Sharma", "sharma ji", "Sharma Ji", "शर्मा", "शर्मा जी", "Cotton Poplin · White", "Cotton Poplin White"];
    const r = await sarvam.transcribe({ data: speak("Sharma ji ko das piece D chaar zero ek do"), mimeType: "audio/wav" }, { keyterms: names, signal: AbortSignal.timeout(45_000) });
    console.log("names:", r.text);
    expect(r.text.length).toBeGreaterThan(5);
  }, 60_000);
});
