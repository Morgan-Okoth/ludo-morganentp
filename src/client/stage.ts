/** Renderer, table, lights, camera and input for the 3D game. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ease, tickTweens, tween } from "./anim";
import type { Assets } from "./assets";
import { buildBoard, type BoardMeshes } from "./board3d";
import { Die } from "./dice";
import { Fx } from "./fx";
import { Layout } from "./layout";
import { feltTexture, woodTexture } from "./textures";

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  readonly controls: OrbitControls;
  readonly fx: Fx;
  readonly die: Die;
  /** Everything that belongs to the current board (scaled together). */
  readonly world = new THREE.Group();
  layout: Layout = new Layout(4);
  board: BoardMeshes | null = null;
  private boardRoot = new THREE.Group();
  private frameCbs: ((dt: number, time: number) => void)[] = [];
  private last = performance.now();
  private raycaster = new THREE.Raycaster();
  private down: { x: number; y: number; t: number } | null = null;
  /** Idle turntable spin (menu backdrop). */
  spin = 0;
  onTap: ((hit: THREE.Intersection | null, ground: THREE.Vector3 | null) => void) | null = null;
  private decor = new THREE.Group();

  constructor(
    private host: HTMLElement,
    readonly assets: Assets,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Neutral tone mapping keeps the classic Ludo colours saturated.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.buildTable();
    this.buildLights();
    this.scene.add(this.world);
    this.world.add(this.boardRoot);
    this.world.add(this.decor);

    this.fx = new Fx(this.world);
    this.die = new Die(this.world);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.22;
    this.controls.rotateSpeed = 0.6;
    this.controls.target.set(0, 0, 0);

    this.setLayout(4);
    this.bindInput();
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private buildTable() {
    const wood = woodTexture("#5a2d0c", "#1e0b02", 23);
    wood.repeat.set(2, 2);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(26, 26, 1.2, 96),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.42, metalness: 0.05 }),
    );
    top.position.y = -0.6;
    top.receiveShadow = true;
    this.scene.add(top);

    // Felt playing mat under the board.
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(19, 19, 0.04, 96),
      new THREE.MeshStandardMaterial({ map: feltTexture("#0f3d24"), roughness: 0.95 }),
    );
    felt.position.y = 0.02;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // Gold inlay ring around the felt.
    const inlay = new THREE.Mesh(
      new THREE.TorusGeometry(19.1, 0.09, 8, 160),
      new THREE.MeshStandardMaterial({ color: "#c9a227", metalness: 1, roughness: 0.3 }),
    );
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = 0.04;
    this.scene.add(inlay);

    const legMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5 });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(3, 6, 22, 48), legMat);
    pedestal.position.y = -12.2;
    this.scene.add(pedestal);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight("#ffe3b8", "#1a0800", 0.55));
    // Warm lamp above the table.
    const lamp = new THREE.SpotLight("#ffd9a0", 1600, 90, Math.PI / 5, 0.55, 1.6);
    lamp.position.set(4, 34, 8);
    lamp.target.position.set(0, 0, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.normalBias = 0.02;
    lamp.shadow.camera.near = 10;
    lamp.shadow.camera.far = 70;
    this.scene.add(lamp, lamp.target);
    const fill = new THREE.DirectionalLight("#9ec7ff", 0.35);
    fill.position.set(-20, 12, -14);
    this.scene.add(fill);
  }

  /** Rebuilds the board for `arms` sides and frames the camera. */
  setLayout(arms: number) {
    if (this.board && this.layout.arms === arms) return;
    this.layout = new Layout(arms);
    this.boardRoot.clear();
    this.board = buildBoard(this.layout);
    this.boardRoot.add(this.board.group);
    this.board.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.castShadow !== false) o.receiveShadow = true;
    });
    // Board units are cells; scale so every board fits the felt mat.
    const s = 15.5 / (this.layout.cornerRadius + 1.2);
    this.world.scale.setScalar(s);
    this.placeDecor();
    this.resize();
  }

  get worldScale() {
    return this.world.scale.x;
  }

  /** Board-unit position to world position. */
  toWorld(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).multiplyScalar(this.worldScale);
  }

  private placeDecor() {
    this.decor.clear();
    const cup = this.assets.dicecup();
    const l = this.layout;
    const t = l.theta(0) + Math.PI / l.arms;
    const r = l.cornerRadius + 1.9;
    cup.position.set(Math.cos(t) * r, 0, Math.sin(t) * r);
    cup.scale.multiplyScalar(1.4);
    cup.rotation.z = 0.05;
    this.decor.add(cup);
  }

  /** Camera framing so the whole board fits on screen, viewed from `arm`'s side. */
  private viewFor(arm: number) {
    const l = this.layout;
    const t = l.theta(arm);
    const aspect = this.camera.aspect;
    // Board radius in world units is about 15.5 (see setLayout).
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = (15.5 * (aspect < 1 ? 1.02 : 1.08)) / (tanHalf * Math.min(1, aspect));
    // Portrait screens look more top-down so the board uses the width.
    const elev = aspect < 1 ? 1.22 : 0.98; // radians above the table
    return new THREE.Vector3(Math.cos(t) * Math.cos(elev) * dist, Math.sin(elev) * dist, Math.sin(t) * Math.cos(elev) * dist);
  }

  viewArm = 0;

  async lookFrom(arm: number, animate = true) {
    this.viewArm = arm;
    const to = this.viewFor(arm);
    if (!animate) {
      this.camera.position.copy(to);
      this.controls.update();
      return;
    }
    const from = this.camera.position.clone();
    // Orbit around the centre rather than cutting through the board.
    const fromSph = new THREE.Spherical().setFromVector3(from);
    const toSph = new THREE.Spherical().setFromVector3(to);
    let dTheta = toSph.theta - fromSph.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const sph = new THREE.Spherical();
    await tween(900, (k) => {
      const e = ease.inOutCubic(k);
      sph.set(
        THREE.MathUtils.lerp(fromSph.radius, toSph.radius, e),
        THREE.MathUtils.lerp(fromSph.phi, toSph.phi, e),
        fromSph.theta + dTheta * e,
      );
      this.camera.position.setFromSpherical(sph);
      this.camera.lookAt(this.controls.target);
    });
  }

  onFrame(cb: (dt: number, time: number) => void) {
    this.frameCbs.push(cb);
  }

  private resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    // Nudge the picture up so the bottom HUD does not cover the near board edge.
    this.camera.setViewOffset(w, h, 0, h * 0.045, w, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.controls) void this.lookFrom(this.viewArm, false);
    this.controls.minDistance = 12;
    this.controls.maxDistance = 110;
  }

  private bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener("pointerup", (e) => {
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hits = this.raycaster.intersectObjects(this.scene.children, true).filter((h) => h.object.visible);
      const ground = new THREE.Vector3();
      const ok = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5 * this.worldScale), ground);
      this.onTap?.(hits[0] ?? null, ok ? ground.divideScalar(this.worldScale) : null);
    });
  }

  private frame(time: number) {
    const dt = Math.min(0.05, (time - this.last) / 1000);
    this.last = time;
    tickTweens(time);
    if (this.spin) {
      const sph = new THREE.Spherical().setFromVector3(this.camera.position);
      sph.theta += this.spin * dt;
      this.camera.position.setFromSpherical(sph);
      this.camera.lookAt(this.controls.target);
    } else {
      this.controls.update();
    }
    this.fx.update(dt);
    this.die.update(dt);
    for (const cb of this.frameCbs) cb(dt, time);
    this.renderer.render(this.scene, this.camera);
  }
}
