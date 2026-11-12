/**
 * Long voice notes: the phone sends WAV, the server cuts it into pieces
 * Sarvam accepts (30 seconds at most), at pauses rather than mid-word.
 */
import { describe, expect, it } from "vitest";
import { encodeWav, parseWav, splitWav, SPEECH_RATE, toMono } from "@/lib/wav";

/** Speech-like tone with silent gaps at the given seconds (half a second each). */
function speech(seconds: number, gapsAt: number[] = []) {
  const s = new Float32Array(seconds * SPEECH_RATE);
  for (let i = 0; i < s.length; i++) {
    const t = i / SPEECH_RATE;
    s[i] = gapsAt.some((g) => t >= g && t < g + 0.5) ? 0 : 0.5 * Math.sin(2 * Math.PI * 220 * t);
  }
  return s;
}
const seconds = (wav: Uint8Array) => {
  const p = parseWav(wav)!;
  return p.data.length / 2 / p.channels / p.rate;
};

describe("WAV", () => {
  it("reads back what it wrote", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]));
    const p = parseWav(wav)!;
    expect(p).toMatchObject({ rate: SPEECH_RATE, channels: 1 });
    const v = new DataView(p.data.buffer, p.data.byteOffset);
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(i * 2, true))).toEqual([0, 16383, -16384, 32767, -32768]);
  });

  it("makes one 16 kHz channel from a 48 kHz stereo recording", () => {
    const left = new Float32Array(48_000).fill(0.4);
    const right = new Float32Array(48_000).fill(0.2);
    const mono = toMono([left, right], 48_000);
    expect(mono.length).toBe(16_000);
    expect(mono[100]).toBeCloseTo(0.3);
  });

  it("is not fooled by other formats", () => {
    expect(parseWav(new TextEncoder().encode("\x1aE\xdf\xa3webm"))).toBeNull();
    const notes = new Uint8Array([1, 2, 3]);
    expect(splitWav(notes)).toEqual([notes]);
  });
});

describe("cutting long notes", () => {
  it("leaves short notes whole", () => {
    const wav = encodeWav(speech(20));
    expect(splitWav(wav)).toEqual([wav]);
  });

  it("cuts a 70-second note at the pauses, every piece under 30 seconds, nothing lost", () => {
    const wav = encodeWav(speech(70, [24, 49]));
    const pieces = splitWav(wav);
    expect(pieces).toHaveLength(3);
    const lengths = pieces.map(seconds);
    for (const l of lengths) expect(l).toBeLessThanOrEqual(28);
    // Cut inside the half-second gaps.
    expect(lengths[0]).toBeGreaterThanOrEqual(24);
    expect(lengths[0]).toBeLessThanOrEqual(24.5);
    expect(lengths[0] + lengths[1]).toBeGreaterThanOrEqual(49);
    expect(lengths[0] + lengths[1]).toBeLessThanOrEqual(49.5);
    // Joined back, the sound is exactly the original.
    const joined = Buffer.concat(pieces.map((p) => parseWav(p)!.data));
    expect(Buffer.compare(joined, Buffer.from(parseWav(wav)!.data))).toBe(0);
  });

  it("still cuts a note with no pauses, at the limit", () => {
    const pieces = splitWav(encodeWav(speech(120)));
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    for (const p of pieces) expect(seconds(p)).toBeLessThanOrEqual(28);
    expect(pieces.reduce((s, p) => s + seconds(p), 0)).toBeCloseTo(120);
  });

  it("works on a Buffer slice, as the server reads uploads", () => {
    const wav = encodeWav(speech(40, [20]));
    const padded = Buffer.concat([Buffer.from("xxxx"), Buffer.from(wav)]).subarray(4);
    expect(splitWav(padded)).toHaveLength(2);
  });
});
