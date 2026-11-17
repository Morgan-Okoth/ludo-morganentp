/** Canvas-generated textures, so the game needs no image downloads. */
import * as THREE from "three";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** Seeded PRNG so textures look the same on every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

export function woodTexture(base: string, dark: string, seed = 7, size = 1024): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // Grain: long wavy strokes.
  for (let i = 0; i < 260; i++) {
    const y = r() * size;
    const amp = 4 + r() * 18;
    const freq = 0.002 + r() * 0.006;
    const phase = r() * Math.PI * 2;
    g.strokeStyle = dark;
    g.globalAlpha = 0.04 + r() * 0.12;
    g.lineWidth = 0.6 + r() * 2.4;
    g.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const yy = y + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1) * amp * 0.25;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  // A few knots.
  for (let i = 0; i < 4; i++) {
    const x = r() * size;
    const y = r() * size;
    for (let k = 10; k > 0; k--) {
      g.globalAlpha = 0.05;
      g.fillStyle = dark;
      g.beginPath();
      g.ellipse(x, y, k * 5, k * 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function feltTexture(color: string, size = 512): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const r = rng(3);
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 18;
    img.data[i] = Math.min(255, Math.max(0, img.data[i]! + n));
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1]! + n));
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2]! + n));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Gold engraved text strip, used for the MORGAN OKOTH frame lettering. */
export function textTexture(text: string, w = 1024, h = 96): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.clearRect(0, 0, w, h);
  g.font = `700 ${Math.round(h * 0.55)}px "Cinzel Decorative", "Cinzel", Georgia, serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "#FF8C00";
  g.shadowBlur = h * 0.15;
  g.fillStyle = "#FFD700";
  const spaced = text.split("").join("\u200A\u200A");
  g.fillText(spaced, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Die face with n pips. */
export function pipTexture(n: number, pip = "#1a1a1a", size = 256): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  g.fillStyle = "#fbf8f0";
  g.fillRect(0, 0, size, size);
  const at: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
  };
  for (const [x, y] of at[n]!) {
    const grad = g.createRadialGradient(x * size - 4, y * size - 4, 2, x * size, y * size, size * 0.09);
    grad.addColorStop(0, n === 1 ? "#ff5a4f" : "#444");
    grad.addColorStop(1, n === 1 ? "#b71c1c" : pip);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x * size, y * size, size * (n === 1 ? 0.12 : 0.085), 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Soft round sprite for particles and glows. */
export function glowTexture(size = 128): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
