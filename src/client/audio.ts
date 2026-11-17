/** Synthesized sound effects (Web Audio), so there are no audio downloads. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = localStorage.getItem("ludo.muted") === "1";

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem("ludo.muted", m ? "1" : "0");
}

/** Browsers only allow audio after a user gesture; call from any click. */
export function unlock() {
  ac();
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.3, delay = 0, slideTo?: number) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, freq: number, vol = 0.3, delay = 0) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + delay;
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  diceShake() {
    for (let i = 0; i < 5; i++) noise(0.05, 2400 + Math.random() * 1200, 0.18, i * 0.05);
  },
  diceHit(strength = 1) {
    noise(0.06, 1800 + Math.random() * 600, 0.35 * strength);
    tone(180 + Math.random() * 60, 0.06, "triangle", 0.15 * strength);
  },
  step(i = 0) {
    tone(520 + (i % 6) * 40, 0.07, "sine", 0.18);
  },
  enter() {
    tone(392, 0.12, "triangle", 0.25);
    tone(587, 0.18, "triangle", 0.25, 0.08);
  },
  capture() {
    tone(660, 0.35, "sawtooth", 0.18, 0, 110);
    noise(0.25, 900, 0.3, 0.02);
  },
  home() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "triangle", 0.22, i * 0.08));
  },
  yourTurn() {
    tone(880, 0.25, "sine", 0.16);
    tone(1320, 0.3, "sine", 0.1, 0.06);
  },
  win() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => tone(f, 0.35, "triangle", 0.25, i * 0.13));
    notes.forEach((f, i) => tone(f / 2, 0.35, "sine", 0.15, i * 0.13));
  },
  skip() {
    tone(300, 0.2, "sine", 0.15, 0, 200);
  },
};
