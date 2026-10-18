// Audio sources feeding the rolling buffer: the real microphone, or deterministic simulated audio.

export type SourceKind = 'microphone' | 'simulated';

export interface AudioSource {
  kind: SourceKind;
  label: string;
  sampleRate: number;
  stop(): void;
}

export class CaptureError extends Error {
  readonly kind: 'permission' | 'no_device' | 'capture';
  constructor(kind: CaptureError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export async function startMicrophone(
  deviceId: string | null,
  onChunk: (c: Float32Array) => void,
  onEnded: () => void,
): Promise<AudioSource> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CaptureError('capture', 'This browser does not support microphone capture (HTTPS or localhost required).');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        // Browser voice processing would alter the machine's acoustic signature.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CaptureError('permission', 'Microphone access was blocked.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CaptureError('no_device', 'No matching microphone was found.');
    }
    throw new CaptureError('capture', (err as Error).message || 'Could not start the microphone.');
  }

  // Native rate is preserved; the backend resamples to the model rate (agreed integration plan).
  const ctx = new AudioContext();
  // Created after the permission prompt, so the browser may start it suspended: wake it explicitly.
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  try {
    await ctx.audioWorklet.addModule('/worklets/capture-processor.js');
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new CaptureError('capture', 'Audio processing (AudioWorklet) is unavailable in this browser.');
  }
  const node = new AudioWorkletNode(ctx, 'capture-processor');
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
  const src = ctx.createMediaStreamSource(stream);
  src.connect(node);
  // Keep the graph pulled without making the mic audible.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);

  const track = stream.getAudioTracks()[0];
  track.addEventListener('ended', onEnded, { once: true });

  return {
    kind: 'microphone',
    label: track.label || 'Microphone',
    sampleRate: ctx.sampleRate,
    stop() {
      track.removeEventListener('ended', onEnded);
      stream.getTracks().forEach((t) => t.stop());
      node.port.onmessage = null;
      void ctx.close();
    },
  };
}

export type SimulatedProfile = 'normal' | 'anomaly' | 'spike' | 'silence';

/**
 * Synthetic fan-like audio (hum, blade-pass harmonics, broadband noise). The anomaly profile adds a
 * tonal whine and periodic knocks so the spectrogram visibly matches the scripted scores.
 */
export function startSimulated(
  onChunk: (c: Float32Array) => void,
  profile: () => SimulatedProfile,
  sampleRate = 16000,
  prefillMs = 0,
): AudioSource {
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  let t = 0; // sample index
  let lp = 0;
  const chunkMs = 50;
  const n = Math.round((sampleRate * chunkMs) / 1000);

  const tick = () => {
    const p = profile();
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++, t++) {
      const s = t / sampleRate;
      if (p === 'silence') {
        out[i] = rand() * 0.0005;
        continue;
      }
      lp += 0.08 * (rand() - lp);
      const wobble = 1 + 0.03 * Math.sin(2 * Math.PI * 0.4 * s);
      let x =
        0.16 * Math.sin(2 * Math.PI * 120 * s) +
        0.08 * Math.sin(2 * Math.PI * 360 * s * wobble) +
        0.05 * Math.sin(2 * Math.PI * 720 * s) +
        0.6 * lp +
        0.03 * rand();
      if (p === 'anomaly') {
        x += 0.07 * Math.sin(2 * Math.PI * 2750 * s) * (1 + 0.5 * Math.sin(2 * Math.PI * 3 * s));
        const knock = s % 0.45;
        if (knock < 0.012) x += 0.5 * Math.exp(-knock * 400) * rand() * 2;
      } else if (p === 'spike') {
        const k = s % 10;
        if (k > 3 && k < 3.4) x += 0.35 * Math.sin(2 * Math.PI * 1900 * s) + 0.3 * rand();
      }
      out[i] = x;
    }
    onChunk(out);
  };
  for (let i = 0; i < prefillMs / chunkMs; i++) tick(); // history so charts start full
  const timer = setInterval(tick, chunkMs);

  return {
    kind: 'simulated',
    label: 'Simulated audio (deterministic)',
    sampleRate,
    stop: () => clearInterval(timer),
  };
}
