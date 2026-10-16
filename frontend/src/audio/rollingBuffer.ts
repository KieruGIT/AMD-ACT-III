/** Fixed-capacity mono PCM ring buffer. `total` counts every sample ever written. */
export class RollingBuffer {
  private readonly data: Float32Array;
  readonly capacity: number;
  total = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity);
  }

  get size() {
    return Math.min(this.total, this.capacity);
  }

  push(chunk: Float32Array) {
    // Only the newest `capacity` samples of an oversized chunk can survive.
    const src = chunk.length > this.capacity ? chunk.subarray(chunk.length - this.capacity) : chunk;
    const start = (this.total + chunk.length - src.length) % this.capacity;
    const first = Math.min(src.length, this.capacity - start);
    this.data.set(src.subarray(0, first), start);
    this.data.set(src.subarray(first), 0);
    this.total += chunk.length;
  }

  /** Copies the `n` samples ending at absolute index `end` (exclusive) into `out`. Missing samples are 0. */
  readEndingAt(end: number, n: number, out = new Float32Array(n)): Float32Array {
    const oldest = this.total - this.size;
    for (let i = 0; i < n; i++) {
      const abs = end - n + i;
      out[i] = abs >= oldest && abs < this.total ? this.data[abs % this.capacity] : 0;
    }
    return out;
  }

  latest(n: number) {
    return this.readEndingAt(this.total, Math.min(n, this.size));
  }

  clear() {
    this.total = 0;
    this.data.fill(0);
  }
}
