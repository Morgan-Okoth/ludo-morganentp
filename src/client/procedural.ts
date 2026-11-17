/**
 * Procedural models. They are the in-game fallback when a Clay-generated GLB
 * is missing, and they are rendered as the reference images sent to Clay's
 * image-to-3D endpoint (see tools/clay).
 */
import * as THREE from "three";

const v = (x: number, y: number) => new THREE.Vector2(x, y);

/** Pawn about 1 unit tall, base radius about 0.36, origin at the base centre. */
export function pawnGeometry(): THREE.BufferGeometry {
  const profile = [
    v(0, 0), v(0.36, 0), v(0.38, 0.03), v(0.38, 0.08), v(0.33, 0.12),
    v(0.3, 0.14), v(0.32, 0.18), v(0.26, 0.22), v(0.18, 0.3), v(0.13, 0.42),
    v(0.11, 0.55), v(0.2, 0.6), v(0.21, 0.63), v(0.12, 0.66),
  ];
  // Spherical head.
  const r = 0.2;
  const cy = 0.66 + r * 0.82;
  const a0 = Math.asin(-0.82); // where the head meets the neck
  for (let i = 1; i <= 12; i++) {
    const a = a0 + (i / 12) * (Math.PI / 2 - a0);
    profile.push(v(i === 12 ? 0 : Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  const g = new THREE.LatheGeometry(profile, 48);
  g.computeVertexNormals();
  return g;
}

/** Trophy cup with handles, about 1.6 units tall. */
export function trophyGroup(material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const cup = new THREE.LatheGeometry(
    [
      v(0, 0), v(0.55, 0), v(0.55, 0.08), v(0.42, 0.12), v(0.4, 0.2), v(0.18, 0.28),
      v(0.1, 0.45), v(0.09, 0.62), v(0.16, 0.7), v(0.3, 0.78), v(0.46, 0.95),
      v(0.55, 1.2), v(0.58, 1.5), v(0.52, 1.52), v(0.48, 1.24), v(0.38, 1.0), v(0, 0.92),
    ],
    48,
  );
  g.add(new THREE.Mesh(cup, material));
  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 12, 32, Math.PI * 1.2), material);
    h.position.set(side * 0.58, 1.18, 0);
    h.rotation.z = side > 0 ? -Math.PI * 0.6 : Math.PI * 0.4;
    h.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(h);
  }
  return g;
}

/** Leather dice cup, used as table decoration. */
export function diceCupGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    [
      v(0, 0), v(0.42, 0), v(0.46, 0.04), v(0.46, 0.12), v(0.42, 0.14), v(0.44, 0.9),
      v(0.5, 0.94), v(0.5, 1.02), v(0.44, 1.02), v(0.38, 0.96), v(0.36, 0.2), v(0, 0.18),
    ],
    48,
  );
}
