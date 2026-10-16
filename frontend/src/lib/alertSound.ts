let ctx: AudioContext | null = null;

/** Two short soft tones. Call only after a user gesture (the Start click unlocks audio). */
export function playAlertTone() {
  ctx ??= new AudioContext();
  const t0 = ctx.currentTime;
  for (const [i, f] of [880, 660].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + i * 0.18);
    osc.stop(t0 + i * 0.18 + 0.17);
  }
}
