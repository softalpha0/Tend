/**
 * Visual life for the garden: contact shadows that ground pots on the real
 * desk, drifting focus motes, a bloom burst, watering ripples and butterflies.
 * Each effect is one small mesh or a single Points draw call.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';

function radialTexture(inner: string, outer: string, size = 128): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

let shadowTexture: CanvasTexture | null = null;
let glowTexture: CanvasTexture | null = null;

function glow(): CanvasTexture {
  if (!glowTexture) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    glowTexture = new CanvasTexture(canvas);
    glowTexture.colorSpace = SRGBColorSpace;
  }
  return glowTexture;
}

/** A soft dark ellipse under a pot, so it reads as sitting on the real desk. */
export function createContactShadow(radius: number): Mesh {
  shadowTexture ??= radialTexture('rgba(0,0,0,0.42)', 'rgba(0,0,0,0)');
  const mesh = new Mesh(
    new PlaneGeometry(radius * 2, radius * 2),
    new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.0015;
  mesh.renderOrder = -1;
  mesh.name = 'ContactShadow';
  return mesh;
}

/** Soft glowing pollen that drifts up from the soil during a session. */
export class Motes extends Points<BufferGeometry, PointsMaterial> {
  private particleCount: number;
  private seeds: Float32Array;

  constructor(count = 48) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    super(
      geometry,
      new PointsMaterial({
        size: 0.0055,
        map: glow(),
        color: new Color('#ffd25e'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.particleCount = count;
    this.seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.seeds[i * 3] = Math.random(); // phase
      this.seeds[i * 3 + 1] = Math.random() * Math.PI * 2; // angle
      this.seeds[i * 3 + 2] = 0.3 + Math.random() * 0.7; // speed
    }
    this.frustumCulled = false;
    this.name = 'FocusMotes';
  }

  /** @param intensity 0 hides the motes; 1 is the densest */
  update(time: number, intensity: number): void {
    this.material.opacity += (intensity * 0.85 - this.material.opacity) * 0.05;
    this.visible = this.material.opacity > 0.01;
    if (!this.visible) return;
    const positions = this.geometry.attributes.position as BufferAttribute;
    const shown = Math.ceil(this.particleCount * Math.min(1, 0.35 + intensity * 0.65));
    for (let i = 0; i < this.particleCount; i++) {
      const phase = this.seeds[i * 3];
      const angle = this.seeds[i * 3 + 1];
      const speed = this.seeds[i * 3 + 2];
      const t = (time * 0.12 * speed + phase) % 1;
      const r = 0.015 + 0.05 * t;
      const swirl = angle + t * 2.5;
      if (i < shown) {
        positions.setXYZ(i, Math.cos(swirl) * r, t * 0.26, Math.sin(swirl) * r);
      } else {
        positions.setXYZ(i, 0, -10, 0);
      }
    }
    positions.needsUpdate = true;
  }
}

/** A burst of glowing pollen and petals when a plant blooms. */
export class Burst extends Points<BufferGeometry, PointsMaterial> {
  private velocities: Float32Array;
  private age = Infinity;
  private readonly life = 2.6;
  private particleCount: number;

  constructor(count = 90) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3));
    super(
      geometry,
      new PointsMaterial({
        size: 0.016,
        map: glow(),
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.particleCount = count;
    this.velocities = new Float32Array(count * 3);
    this.frustumCulled = false;
    this.visible = false;
    this.name = 'BloomBurst';
  }

  /** Starts a burst at `origin` (in the parent's space) tinted with `tint`. */
  trigger(origin: Vector3, tint: Color, strength = 1): void {
    const positions = this.geometry.attributes.position as BufferAttribute;
    const colors = this.geometry.attributes.color as BufferAttribute;
    const gold = new Color('#ffc93c');
    for (let i = 0; i < this.particleCount; i++) {
      positions.setXYZ(i, origin.x, origin.y, origin.z);
      const a = Math.random() * Math.PI * 2;
      const up = 0.25 + Math.random() * 0.55;
      const out = (0.08 + Math.random() * 0.22) * strength;
      this.velocities[i * 3] = Math.cos(a) * out;
      this.velocities[i * 3 + 1] = up * strength;
      this.velocities[i * 3 + 2] = Math.sin(a) * out;
      const c = Math.random() < 0.55 ? tint : gold;
      colors.setXYZ(i, c.r, c.g, c.b);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    this.age = 0;
    this.visible = true;
  }

  update(delta: number): void {
    if (this.age >= this.life) {
      this.visible = false;
      return;
    }
    this.age += delta;
    const positions = this.geometry.attributes.position as BufferAttribute;
    for (let i = 0; i < this.particleCount; i++) {
      this.velocities[i * 3 + 1] -= 0.35 * delta; // light gravity: pollen floats
      const drag = 1 - 1.4 * delta;
      this.velocities[i * 3] *= drag;
      this.velocities[i * 3 + 2] *= drag;
      positions.setXYZ(
        i,
        positions.getX(i) + this.velocities[i * 3] * delta,
        positions.getY(i) + this.velocities[i * 3 + 1] * delta,
        positions.getZ(i) + this.velocities[i * 3 + 2] * delta,
      );
    }
    positions.needsUpdate = true;
    const t = this.age / this.life;
    this.material.opacity = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
  }
}

/** Rings that spread across the soil where water lands. */
export class Ripples extends Group {
  private rings: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
  active = false;

  constructor() {
    super();
    for (let i = 0; i < 3; i++) {
      const ring = new Mesh(
        new RingGeometry(0.8, 1, 32),
        new MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.add(ring);
      this.rings.push(ring);
    }
    this.name = 'WaterRipples';
  }

  update(time: number): void {
    this.rings.forEach((ring, i) => {
      const t = (time * 0.9 + i / this.rings.length) % 1;
      ring.scale.setScalar(0.004 + t * 0.045);
      ring.material.opacity = this.active ? (1 - t) * 0.55 : Math.max(0, ring.material.opacity - 0.03);
    });
    this.visible = this.active || this.rings.some((r) => r.material.opacity > 0.01);
  }
}

const WING_COLORS = ['#f6a04d', '#7ec8f2', '#f28fb0', '#fff1a8', '#b49cf0'];
let wingGeometry: ShapeGeometry | null = null;

function wingShape(): ShapeGeometry {
  if (wingGeometry) return wingGeometry;
  // One wing (fore and hind lobe), drawn in metres along +X from the body.
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.004, 0.016, 0.02, 0.022, 0.026, 0.012);
  s.bezierCurveTo(0.03, 0.004, 0.02, 0.0, 0.012, -0.002);
  s.bezierCurveTo(0.02, -0.006, 0.022, -0.016, 0.012, -0.018);
  s.bezierCurveTo(0.006, -0.018, 0.002, -0.01, 0, 0);
  wingGeometry = new ShapeGeometry(s, 8);
  wingGeometry.rotateX(-Math.PI / 2); // lie flat, wing pointing along +X, front toward -Z
  return wingGeometry;
}

/**
 * A small butterfly that wanders between flowers. The controller sets
 * `target`; the butterfly flies there with a little wander and flaps faster
 * in flight than when resting.
 */
export class Butterfly extends Group {
  readonly target = new Vector3();
  resting = false;
  private left = new Group();
  private right = new Group();
  private velocity = new Vector3();
  private toTarget = new Vector3();
  private look = new Vector3();
  private phase = Math.random() * 10;
  private wanderSeed = Math.random() * 100;

  constructor(colorIndex: number) {
    super();
    this.name = 'Butterfly';
    const color = WING_COLORS[colorIndex % WING_COLORS.length];
    const wingMaterial = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.25,
      roughness: 0.6,
      side: DoubleSide,
    });
    const leftWing = new Mesh(wingShape(), wingMaterial);
    leftWing.scale.x = -1;
    this.left.add(leftWing);
    this.right.add(new Mesh(wingShape(), wingMaterial));
    const body = new Mesh(new SphereGeometry(1, 8, 6), new MeshStandardMaterial({ color: '#3b2f2a', roughness: 0.8 }));
    body.scale.set(0.0022, 0.0022, 0.011);
    this.add(this.left, this.right, body);
  }

  update(delta: number, time: number): void {
    this.toTarget.copy(this.target).sub(this.position);
    const distance = this.toTarget.length();
    if (this.resting) {
      this.position.lerp(this.target, Math.min(1, delta * 6));
      this.velocity.multiplyScalar(0.8);
    } else {
      // Steer toward the target, with a little wobble so the flight looks alive.
      const w = this.wanderSeed;
      this.toTarget.x += Math.sin(time * 2.1 + w) * 0.04;
      this.toTarget.y += Math.sin(time * 3.3 + w * 2) * 0.03;
      this.toTarget.z += Math.cos(time * 1.7 + w) * 0.04;
      this.velocity.lerp(this.toTarget.multiplyScalar(2.2), Math.min(1, delta * 2.5));
      const speed = this.velocity.length();
      if (speed > 0.35) this.velocity.multiplyScalar(0.35 / speed);
      this.position.addScaledVector(this.velocity, delta);
    }
    if (this.velocity.lengthSq() > 1e-5) {
      this.look.copy(this.position).add(this.velocity);
      this.look.y = this.position.y;
      this.lookAt(this.look);
      this.rotateY(Math.PI); // the model faces -Z
    }
    const close = distance < 0.01 || this.resting;
    const flap = close ? Math.sin(time * 4 + this.phase) * 0.35 + 0.6 : Math.sin(time * 26 + this.phase) * 0.9;
    this.left.rotation.z = -flap;
    this.right.rotation.z = flap;
  }
}
