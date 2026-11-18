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

function finish(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Wooden floor boards: staggered planks with grain and seams. */
export function plankTexture(size = 1024): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const r = rng(91);
  const rows = 8;
  const h = size / rows;
  for (let row = 0; row < rows; row++) {
    let x = -r() * size * 0.5;
    while (x < size) {
      const w = size * (0.35 + r() * 0.4);
      const shade = 34 + r() * 18;
      g.fillStyle = `hsl(${24 + r() * 6}, ${48 + r() * 12}%, ${shade * 0.55}%)`;
      g.fillRect(x, row * h, w, h);
      // Grain lines along the plank.
      g.globalAlpha = 0.18;
      g.strokeStyle = "#1a0a02";
      for (let k = 0; k < 7; k++) {
        const y = row * h + r() * h;
        g.lineWidth = 0.5 + r() * 1.5;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + w * 0.3, y + (r() - 0.5) * 6, x + w * 0.7, y + (r() - 0.5) * 6, x + w, y);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(x, row * h, 2, h); // butt joint
      x += w;
    }
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(0, row * h, size, 2); // long seam
  }
  return finish(c, true);
}

/**
 * Damask-style wallpaper, one full wall height tall (no vertical repeat):
 * a darker band at the top so the open ceiling fades out.
 */
export function wallpaperTexture(base = "#173b3c", w = 256, h = 1024): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // Vertical stripes.
  for (let x = 0; x < w; x += w / 4) {
    g.fillStyle = "rgba(255,215,140,0.05)";
    g.fillRect(x + w / 8 - 3, 0, 6, h);
  }
  // Repeating diamond motif.
  g.strokeStyle = "rgba(255,215,140,0.13)";
  g.lineWidth = 2;
  for (let y = 0; y < h; y += 64) {
    for (let x = 0; x <= w; x += w / 2) {
      const ox = (y / 64) % 2 ? w / 4 : 0;
      g.beginPath();
      g.moveTo(x + ox, y);
      g.lineTo(x + ox + 18, y + 32);
      g.lineTo(x + ox, y + 64);
      g.lineTo(x + ox - 18, y + 32);
      g.closePath();
      g.stroke();
    }
  }
  const fade = g.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, "rgba(0,0,0,0.92)");
  fade.addColorStop(0.45, "rgba(0,0,0,0.25)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  const t = finish(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Glowing neon lettering on a transparent background. */
export function neonTexture(text: string, color: string, font = '"Brush Script MT","Segoe Script","Lucida Handwriting",cursive', w = 1024, h = 300): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  let size = h * 0.62;
  g.font = `italic 700 ${size}px ${font}`;
  while (g.measureText(text).width > w * 0.88 && size > 20) {
    size -= 4;
    g.font = `italic 700 ${size}px ${font}`;
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  // Wide soft glow, then the tube, then a hot white core.
  for (const [blur, width, alpha] of [[60, 16, 0.5], [30, 10, 0.8], [12, 6, 1]] as const) {
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.strokeText(text, w / 2, h / 2);
  }
  g.globalAlpha = 1;
  g.shadowBlur = 8;
  g.strokeStyle = "#fff6fb";
  g.lineWidth = 2.5;
  g.strokeText(text, w / 2, h / 2);
  return finish(c);
}

/** Gold painted lettering (for "MORGANENTP" and similar wall writing). */
export function paintedTexture(lines: { text: string; size: number; color?: string; font?: string }[], w = 1024, h = 360): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const total = lines.reduce((s, l) => s + l.size * 1.25, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    y += (l.size * 1.25) / 2;
    g.font = `700 ${l.size}px ${l.font ?? '"Cinzel Decorative","Cinzel",Georgia,serif'}`;
    g.shadowColor = "rgba(0,0,0,0.7)";
    g.shadowBlur = 6;
    g.shadowOffsetY = 3;
    g.fillStyle = l.color ?? "#e8c25a";
    g.fillText(l.text, w / 2, y);
    y += (l.size * 1.25) / 2;
  }
  return finish(c);
}

/** Chalkboard with handwritten house rules. */
export function chalkboardTexture(title: string, lines: string[], sign: string, w = 768, h = 512): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  const r = rng(5);
  g.fillStyle = "#1f2b24";
  g.fillRect(0, 0, w, h);
  // Old chalk smudges.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${0.015 + r() * 0.03})`;
    g.beginPath();
    g.ellipse(r() * w, r() * h, 30 + r() * 90, 8 + r() * 25, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const hand = '"Segoe Print","Comic Sans MS","Bradley Hand",cursive';
  g.fillStyle = "#f4f1e6";
  g.textBaseline = "top";
  g.font = `700 54px ${hand}`;
  g.textAlign = "center";
  g.fillText(title, w / 2, 26);
  g.font = `400 34px ${hand}`;
  g.textAlign = "left";
  lines.forEach((l, i) => g.fillText(l, 46, 118 + i * 58));
  g.font = `italic 400 30px ${hand}`;
  g.textAlign = "right";
  g.fillStyle = "#ffd0ec";
  g.fillText(sign, w - 40, h - 70);
  return finish(c);
}

/** Name tag shown above a seated player. */
export function labelTexture(text: string, color: string, w = 512, h = 128): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.font = `700 52px "Cinzel","Georgia",serif`;
  const tw = Math.min(w - 20, g.measureText(text).width + 70);
  const x = (w - tw) / 2;
  g.fillStyle = "rgba(20,8,0,0.78)";
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(x, 18, tw, h - 36, (h - 36) / 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2, tw - 40);
  return finish(c);
}

/** A small framed poster of a classic Ludo board. */
export function boardPosterTexture(size = 512): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const cell = size / 15;
  g.fillStyle = "#f5e6c8";
  g.fillRect(0, 0, size, size);
  const corners: [number, number, string][] = [[0, 0, "#D32F2F"], [9, 0, "#388E3C"], [0, 9, "#F9A825"], [9, 9, "#1565C0"]];
  for (const [cx, cy, col] of corners) {
    g.fillStyle = col;
    g.fillRect(cx * cell, cy * cell, 6 * cell, 6 * cell);
    g.fillStyle = "#fafafa";
    g.beginPath();
    g.arc((cx + 3) * cell, (cy + 3) * cell, 2.1 * cell, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 1;
  for (let i = 0; i < 15; i++) {
    for (let j = 0; j < 15; j++) {
      const inCross = (i >= 6 && i <= 8) || (j >= 6 && j <= 8);
      if (inCross) g.strokeRect(i * cell, j * cell, cell, cell);
    }
  }
  const tri = (x1: number, y1: number, x2: number, y2: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(7.5 * cell, 7.5 * cell);
    g.lineTo(x1 * cell, y1 * cell);
    g.lineTo(x2 * cell, y2 * cell);
    g.fill();
  };
  tri(6, 6, 9, 6, "#388E3C");
  tri(9, 6, 9, 9, "#1565C0");
  tri(9, 9, 6, 9, "#F9A825");
  tri(6, 9, 6, 6, "#D32F2F");
  return finish(c);
}
