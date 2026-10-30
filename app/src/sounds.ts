// Lightweight Web Audio cues. No assets; tones are synthesised on the fly.

let ctx: AudioContext | null = null;
function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain = 0.18, type: OscillatorType = "sine") {
  const c = ac();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Rising minor-key arpeggio for leveling up — a touch triumphant, a touch dark. */
export function playLevelUp() {
  try {
    const notes = [392.0, 523.25, 659.25, 783.99]; // G4 C5 E5 G5
    notes.forEach((f, i) => tone(f, i * 0.11, 0.5, 0.16, "triangle"));
    tone(1046.5, 0.44, 0.7, 0.12, "sine"); // sparkle on top
  } catch {
    /* audio not available */
  }
}

/** Soft 440Hz chime for the end of a Pomodoro session. */
export function playChime() {
  try {
    tone(440, 0, 0.3, 0.2, "sine");
    tone(660, 0.18, 0.4, 0.14, "sine");
  } catch {
    /* audio not available */
  }
}
