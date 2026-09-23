/** Wrap little-endian signed 16-bit PCM from Csound's WASM runtime. */
export function pcm16ToWave(pcm: Uint8Array, sampleRate: number, channels: number) {
  const blockAlign = channels * 2;
  if (!Number.isInteger(channels) || channels < 1 || blockAlign > 0xffff) {
    throw new Error("Csound returned an invalid channel count.");
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate * blockAlign > 0xffffffff) {
    throw new Error("Csound returned an invalid sample rate.");
  }
  if (pcm.length === 0 || pcm.length % blockAlign !== 0 || pcm.length > 0xffffffff - 36) {
    throw new Error("Csound returned incomplete PCM audio.");
  }
  const bytes = new Uint8Array(44 + pcm.length);
  const view = new DataView(bytes.buffer);
  const text = new TextEncoder();
  bytes.set(text.encode("RIFF"), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(text.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  bytes.set(text.encode("data"), 36);
  view.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  return bytes;
}
