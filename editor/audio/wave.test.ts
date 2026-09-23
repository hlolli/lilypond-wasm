import { expect, test } from "bun:test";
import { pcm16ToWave } from "./wave";

test("preserves every PCM byte and records the actual mono format", () => {
  const pcm = new Uint8Array([0x00, 0x80, 0xff, 0x7f]);
  const wave = pcm16ToWave(pcm, 22050, 1);
  const view = new DataView(wave.buffer);
  expect(view.getUint32(4, true)).toBe(wave.length - 8);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(22050);
  expect(view.getUint32(28, true)).toBe(44100);
  expect(view.getUint16(32, true)).toBe(2);
  expect(view.getUint32(40, true)).toBe(pcm.length);
  expect(wave.subarray(44)).toEqual(pcm);
  pcm.fill(0);
  expect(view.getInt16(44, true)).toBe(-32768);
});

test("rejects empty audio and incomplete stereo frames", () => {
  expect(() => pcm16ToWave(new Uint8Array(), 48000, 2)).toThrow("incomplete PCM");
  expect(() => pcm16ToWave(new Uint8Array(6), 48000, 2)).toThrow("incomplete PCM");
});

test("rejects invalid or overflowing audio formats", () => {
  for (const sampleRate of [0, NaN, Infinity, 1.5, 2 ** 32]) {
    expect(() => pcm16ToWave(new Uint8Array(4), sampleRate, 2)).toThrow("sample rate");
  }
  for (const channels of [0, NaN, 1.5, 32768]) {
    expect(() => pcm16ToWave(new Uint8Array(4), 48000, channels)).toThrow("channel count");
  }
});
