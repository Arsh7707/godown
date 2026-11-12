/**
 * 16-bit PCM WAV, the one audio format both the phone and the server can
 * cut without a decoder. Long voice notes go up as WAV so the server can
 * split them at pauses: Sarvam refuses anything over 30 seconds.
 */

/** Speech needs no more; 32 KB per second. */
export const SPEECH_RATE = 16_000;

/** Averages the channels to one and resamples (box filter: plenty for speech). */
export function toMono(channels: Float32Array[], rate: number, target = SPEECH_RATE): Float32Array {
  const n = channels[0]?.length ?? 0;
  const ratio = rate / target;
  const out = new Float32Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(n, Math.max(from + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (const c of channels) for (let j = from; j < to; j++) sum += c[j];
    out[i] = sum / ((to - from) * channels.length);
  }
  return out;
}

function header(dataBytes: number, rate: number, channels: number, bits: number): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((ch, i) => (h[at + i] = ch.charCodeAt(0)));
  const block = channels * (bits / 8);
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * block, true);
  v.setUint16(32, block, true);
  v.setUint16(34, bits, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  return h;
}

/** Mono samples (-1..1) as a WAV file. */
export function encodeWav(samples: Float32Array, rate = SPEECH_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  out.set(header(samples.length * 2, rate, 1, 16));
  const v = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

interface Pcm {
  rate: number;
  channels: number;
  /** The sample bytes (16-bit little-endian, interleaved). */
  data: Uint8Array;
}

/** Reads a 16-bit PCM WAV; null for anything else (webm, mp4, ogg…). */
export function parseWav(buf: Uint8Array): Pcm | null {
  const tag = (at: number) => String.fromCharCode(...buf.subarray(at, at + 4));
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let fmt: { rate: number; channels: number } | null = null;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= buf.length) {
      if (v.getUint16(body, true) !== 1 || v.getUint16(body + 14, true) !== 16) return null;
      fmt = { channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true) };
    } else if (id === "data") {
      if (!fmt || !fmt.channels || !fmt.rate) return null;
      // Streamed recorders sometimes leave the size unset: take what's there.
      const end = Math.min(buf.length, body + size);
      const block = fmt.channels * 2;
      return { ...fmt, data: buf.subarray(body, body + Math.floor((end - body) / block) * block) };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/**
 * Cuts a WAV into pieces of at most `maxSeconds`, each cut at the quietest
 * tenth of a second in the last `searchSeconds` before the limit, so words
 * aren't split in half. Anything that isn't a 16-bit WAV, or is short
 * enough already, comes back whole.
 */
export function splitWav(buf: Uint8Array, maxSeconds = 28, searchSeconds = 8): Uint8Array[] {
  const pcm = parseWav(buf);
  if (!pcm) return [buf];
  const block = pcm.channels * 2;
  const frames = pcm.data.length / block;
  const maxFrames = Math.floor(maxSeconds * pcm.rate);
  if (frames <= maxFrames) return [buf];

  const v = new DataView(pcm.data.buffer, pcm.data.byteOffset, pcm.data.byteLength);
  const loudness = (from: number, to: number) => {
    let sum = 0;
    for (let f = from; f < to; f++) sum += Math.abs(v.getInt16(f * block, true));
    return sum;
  };
  const win = Math.max(1, Math.floor(pcm.rate / 10));
  const pieces: Uint8Array[] = [];
  let start = 0;
  while (frames - start > maxFrames) {
    const limit = start + maxFrames;
    let cut = limit;
    let quietest = Infinity;
    for (let w = Math.max(start + win, limit - Math.floor(searchSeconds * pcm.rate)); w + win <= limit; w += win) {
      const l = loudness(w, w + win);
      if (l < quietest) [quietest, cut] = [l, w + Math.floor(win / 2)];
    }
    pieces.push(piece(pcm, start, cut));
    start = cut;
  }
  pieces.push(piece(pcm, start, frames));
  return pieces;
}

function piece(pcm: Pcm, from: number, to: number): Uint8Array {
  const block = pcm.channels * 2;
  const data = pcm.data.subarray(from * block, to * block);
  const out = new Uint8Array(44 + data.length);
  out.set(header(data.length, pcm.rate, pcm.channels, 16));
  out.set(data, 44);
  return out;
}
