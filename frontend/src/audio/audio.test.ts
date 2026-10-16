import { describe, expect, it } from 'vitest';
import { RollingBuffer } from './rollingBuffer';
import { encodeWav } from './wavEncoder';
import { fft } from './fft';

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM header and sample count', () => {
    const samples = new Float32Array([0, 1, -1, 0.5, 2, -2]);
    const v = new DataView(encodeWav(samples, 48000));
    const str = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
    expect(str(0)).toBe('RIFF');
    expect(str(8)).toBe('WAVE');
    expect(str(36)).toBe('data');
    expect(v.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(96000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(samples.length * 2);
    expect(v.byteLength).toBe(44 + samples.length * 2);
    const pcm = [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true));
    expect(pcm).toEqual([0, 32767, -32768, 16383, 32767, -32768]); // out-of-range input is clipped
  });

  it('3 s at 16 kHz fits the contract upload limit', () => {
    expect(encodeWav(new Float32Array(48000), 16000).byteLength).toBe(96044);
  });
});

describe('RollingBuffer', () => {
  it('keeps the newest samples across wrap-around', () => {
    const b = new RollingBuffer(5);
    b.push(new Float32Array([1, 2, 3]));
    b.push(new Float32Array([4, 5, 6, 7]));
    expect(b.size).toBe(5);
    expect(b.total).toBe(7);
    expect(Array.from(b.latest(5))).toEqual([3, 4, 5, 6, 7]);
    expect(Array.from(b.latest(2))).toEqual([6, 7]);
  });

  it('handles chunks larger than capacity and zero-fills unavailable samples', () => {
    const b = new RollingBuffer(3);
    b.push(new Float32Array([1, 2, 3, 4, 5]));
    expect(Array.from(b.latest(3))).toEqual([3, 4, 5]);
    expect(Array.from(b.readEndingAt(b.total, 4))).toEqual([0, 3, 4, 5]);
    b.clear();
    expect(b.size).toBe(0);
  });
});

describe('fft', () => {
  it('puts a pure tone in the expected bin', () => {
    const n = 64;
    const re = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 5 * i) / n));
    const im = new Float32Array(n);
    fft(re, im);
    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    expect(mags.indexOf(Math.max(...mags))).toBe(5);
  });
});
