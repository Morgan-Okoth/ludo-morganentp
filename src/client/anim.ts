/** Minimal tween system driven by the render loop. */

type Tween = { start: number; dur: number; update: (t: number) => void; done: () => void };

const tweens = new Set<Tween>();
let now = 0;

export function tickTweens(time: number): void {
  now = time;
  for (const tw of [...tweens]) {
    const t = Math.min(1, (time - tw.start) / tw.dur);
    tw.update(t);
    if (t >= 1) {
      tweens.delete(tw);
      tw.done();
    }
  }
}

/** Runs update(t) with t in [0, 1] for `ms` milliseconds. */
export function tween(ms: number, update: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    tweens.add({ start: now || performance.now(), dur: Math.max(1, ms), update, done: resolve });
  });
}

export const wait = (ms: number) => tween(ms, () => {});

/** Speed multiplier for all game animations (1 = normal). */
export const speed = { factor: 1 };
export const ms = (n: number) => n / speed.factor;

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  smooth: (a: number, b: number, t: number) => {
    const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
  },
};
