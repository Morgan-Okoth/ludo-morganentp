/** Particle bursts, sparkles and confetti. */
import * as THREE from "three";
import { glowTexture } from "./textures";

interface Particle {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
  fade: boolean;
}

export class Fx {
  private particles: Particle[] = [];
  private glow = glowTexture();
  private confettiGeo = new THREE.PlaneGeometry(0.16, 0.26);

  constructor(private scene: THREE.Object3D) {}

  burst(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 40, power = 5) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.glow,
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const s = new THREE.Sprite(mat);
      const size = 0.15 + Math.random() * 0.35;
      s.scale.setScalar(size);
      s.position.copy(at);
      this.scene.add(s);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize();
      this.particles.push({
        obj: s,
        vel: dir.multiplyScalar(power * (0.4 + Math.random() * 0.8)),
        spin: new THREE.Vector3(),
        life: 0,
        max: 0.6 + Math.random() * 0.6,
        gravity: 9,
        fade: true,
      });
    }
  }

  /** Ring of light expanding on the board, used when a token lands home or enters. */
  shockwave(at: THREE.Vector3, color: THREE.ColorRepresentation) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.45, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(at);
    this.scene.add(m);
    this.particles.push({ obj: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 0.6, gravity: 0, fade: true });
  }

  confetti(centre: THREE.Vector3, colors: THREE.ColorRepresentation[], count = 260, radius = 10) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length],
        side: THREE.DoubleSide,
        roughness: 0.4,
        metalness: 0.3,
        transparent: true,
      });
      const m = new THREE.Mesh(this.confettiGeo, mat);
      m.position.set(
        centre.x + (Math.random() - 0.5) * radius * 2,
        centre.y + 8 + Math.random() * 8,
        centre.z + (Math.random() - 0.5) * radius * 2,
      );
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(m);
      this.particles.push({
        obj: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, -1.5 - Math.random() * 2, (Math.random() - 0.5) * 1.5),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        life: 0,
        max: 5 + Math.random() * 3,
        gravity: 0.4,
        fade: true,
      });
    }
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      p.vel.y -= p.gravity * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.spin.x * dt;
      p.obj.rotation.y += p.spin.y * dt;
      p.obj.rotation.z += p.spin.z * dt;
      const k = p.life / p.max;
      if (p.obj instanceof THREE.Mesh && p.obj.geometry instanceof THREE.RingGeometry) {
        p.obj.scale.setScalar(1 + k * 4);
      }
      const mat = (p.obj as THREE.Mesh | THREE.Sprite).material as THREE.Material & { opacity: number };
      if (p.fade) mat.opacity = Math.max(0, 1 - k * k);
      if (p.life >= p.max || p.obj.position.y < -2) {
        this.scene.remove(p.obj);
        mat.dispose();
        if (p.obj instanceof THREE.Mesh && p.obj.geometry !== this.confettiGeo) p.obj.geometry.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.particles) this.scene.remove(p.obj);
    this.particles = [];
  }
}
