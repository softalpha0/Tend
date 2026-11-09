/**
 * Procedural models for Tend: the pot, seed, plant, time ring, labels and the
 * desktop-preview table. Everything is built from simple Three.js shapes so
 * the app has no model files to download.
 */
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  MeshBasicMaterial,
  PlaneGeometry,
  DoubleSide,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
} from '@iwsdk/core';
import type { SpeciesId } from './species.js';
import { createContactShadow } from './effects.js';

export const BLOOM_COLORS = ['#f28fb0', '#f6c453', '#a596f5', '#f4845f', '#6cc4e8', '#fdfdfd'];

// Pot dimensions in metres.
export const POT_HEIGHT = 0.085;
export const POT_RADIUS = 0.06;
export const SOIL_Y = POT_HEIGHT - 0.01;

const GREEN = new Color('#4f9d4a');
const DARK_GREEN = new Color('#3b7a38');
const WILT_BROWN = new Color('#8a6a3c');

/** Shared pot materials: every pot reuses them, so the garden stays cheap to draw. */
const POT_MATERIALS = {
  clay: new MeshStandardMaterial({ color: '#c96f4a', roughness: 0.82 }),
  rim: new MeshStandardMaterial({ color: '#b5603e', roughness: 0.75 }),
  glaze: new MeshStandardMaterial({ color: '#f1e3c8', roughness: 0.35, metalness: 0.05, side: DoubleSide }),
  soilMaterial: null as MeshStandardMaterial | null,
  soil(): MeshStandardMaterial {
    if (!this.soilMaterial) {
      // Speckled soil, drawn once into a small texture.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#4a3020';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) {
        const shade = Math.random();
        g.fillStyle = shade < 0.5 ? 'rgba(30,18,10,0.55)' : shade < 0.85 ? 'rgba(110,78,52,0.5)' : 'rgba(170,140,100,0.45)';
        const r = Math.random() * 1.8 + 0.4;
        g.beginPath();
        g.arc(Math.random() * 128, Math.random() * 128, r, 0, Math.PI * 2);
        g.fill();
      }
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      this.soilMaterial = new MeshStandardMaterial({ map: texture, roughness: 1 });
    }
    return this.soilMaterial;
  },
};

export function createPot(): Group {
  const pot = new Group();
  pot.name = 'TendPot';

  const profile = [
    new Vector2(0, 0),
    new Vector2(0.042, 0),
    new Vector2(0.05, 0.03),
    new Vector2(POT_RADIUS - 0.004, POT_HEIGHT - 0.012),
    new Vector2(POT_RADIUS, POT_HEIGHT - 0.012),
    new Vector2(POT_RADIUS, POT_HEIGHT),
    new Vector2(POT_RADIUS - 0.006, POT_HEIGHT),
  ];
  const body = new Mesh(new LatheGeometry(profile, 40), POT_MATERIALS.clay);
  body.name = 'PotBody';
  pot.add(body);

  // A glazed band near the top, like a hand-painted terracotta pot.
  const band = new Mesh(
    new CylinderGeometry(POT_RADIUS - 0.0035, POT_RADIUS - 0.0055, 0.012, 40, 1, true),
    POT_MATERIALS.glaze,
  );
  band.position.y = POT_HEIGHT - 0.022;
  pot.add(band);

  const rim = new Mesh(new TorusGeometry(POT_RADIUS - 0.002, 0.0042, 10, 40), POT_MATERIALS.rim);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = POT_HEIGHT;
  pot.add(rim);

  const soil = new Mesh(new CircleGeometry(POT_RADIUS - 0.006, 32), POT_MATERIALS.soil());
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = SOIL_Y;
  pot.add(soil);

  pot.add(createContactShadow(POT_RADIUS * 1.55));
  return pot;
}

export function createSeed(): { seed: Group; glow: Mesh; body: Mesh<SphereGeometry, MeshStandardMaterial> } {
  const seed = new Group();
  seed.name = 'TendSeed';
  const body = new Mesh(
    new SphereGeometry(1, 16, 12),
    new MeshStandardMaterial({ color: '#d9a35f', roughness: 0.6 }),
  );
  body.scale.set(0.011, 0.015, 0.011);
  seed.add(body);

  const glow = new Mesh(
    new SphereGeometry(0.03, 16, 12),
    new MeshStandardMaterial({
      color: '#fff3c4',
      emissive: '#ffe28a',
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  seed.add(glow);
  return { seed, glow, body };
}

/** Per-species look: flower shape, colours and proportions. */
interface PlantLook {
  petals: number;
  petalScale: [number, number, number];
  petalOffset: number;
  /** Petal tilt when fully open: 0 lies flat, positive cups upward. */
  openTilt: number;
  colors: string[];
  center: string;
  centerSize: number;
  heightScale: number;
  flowerScale: number;
  leaves: number;
  leafScale: [number, number, number];
}

const LOOKS: Record<SpeciesId, PlantLook> = {
  daisy: {
    petals: 6, petalScale: [0.02, 0.005, 0.011], petalOffset: 0.018, openTilt: 0,
    colors: BLOOM_COLORS, center: '#f7d046', centerSize: 0.008, heightScale: 1, flowerScale: 1,
    leaves: 6, leafScale: [0.024, 0.004, 0.011],
  },
  tulip: {
    petals: 6, petalScale: [0.012, 0.004, 0.024], petalOffset: 0.006, openTilt: 1.1,
    colors: ['#e5484d', '#f28fb0', '#f4845f', '#f6c453'], center: '#3b2a1a', centerSize: 0.004, heightScale: 1.05,
    flowerScale: 1.1, leaves: 3, leafScale: [0.04, 0.004, 0.012],
  },
  sunflower: {
    petals: 14, petalScale: [0.02, 0.004, 0.007], petalOffset: 0.024, openTilt: 0,
    colors: ['#f6c22b', '#f2a81d'], center: '#5a3a1e', centerSize: 0.016, heightScale: 1.3, flowerScale: 1.3,
    leaves: 6, leafScale: [0.03, 0.004, 0.016],
  },
  lavender: {
    petals: 0, petalScale: [0, 0, 0], petalOffset: 0, openTilt: 0,
    colors: ['#9b7fd1', '#b39ddb'], center: '#9b7fd1', centerSize: 0.006, heightScale: 1.15, flowerScale: 1,
    leaves: 6, leafScale: [0.026, 0.003, 0.006],
  },
  hellebore: {
    petals: 5, petalScale: [0.018, 0.004, 0.015], petalOffset: 0.015, openTilt: 0.5,
    colors: ['#f3efe6', '#8e4a6b'], center: '#e8d36a', centerSize: 0.006, heightScale: 0.8, flowerScale: 1,
    leaves: 4, leafScale: [0.026, 0.004, 0.012],
  },
  cherry: {
    petals: 5, petalScale: [0.012, 0.003, 0.01], petalOffset: 0.01, openTilt: 0.15,
    colors: ['#f7c6d9', '#fde7ef'], center: '#d9537a', centerSize: 0.004, heightScale: 1.1, flowerScale: 0.95,
    leaves: 3, leafScale: [0.02, 0.003, 0.01],
  },
  hibiscus: {
    petals: 5, petalScale: [0.026, 0.004, 0.018], petalOffset: 0.022, openTilt: 0.35,
    colors: ['#e5484d', '#f4845f', '#f6c453'], center: '#c1272d', centerSize: 0.005, heightScale: 1, flowerScale: 1.2,
    leaves: 6, leafScale: [0.026, 0.004, 0.014],
  },
  chrysanthemum: {
    petals: 22, petalScale: [0.016, 0.003, 0.004], petalOffset: 0.013, openTilt: 0.4,
    colors: ['#e07a2f', '#c9483b', '#f2c14e'], center: '#b5651d', centerSize: 0.006, heightScale: 1, flowerScale: 1.1,
    leaves: 6, leafScale: [0.022, 0.004, 0.013],
  },
  cactus: {
    petals: 8, petalScale: [0.012, 0.004, 0.007], petalOffset: 0.011, openTilt: 0.3,
    colors: ['#f06292', '#ff8a65'], center: '#ffe082', centerSize: 0.005, heightScale: 0.45, flowerScale: 0.9,
    leaves: 0, leafScale: [0, 0, 0],
  },
};

/** A plant that can be posed anywhere between sprout, full bloom and wilted. */
export class Plant extends Group {
  private swayPivot = new Group();
  private stemPivot = new Group();
  /** Spring state for a touch: bend angles and their velocities. */
  private bendX = 0;
  private bendZ = 0;
  private bendVX = 0;
  private bendVZ = 0;
  private windPhase = Math.random() * Math.PI * 2;
  private growthNow = 0;
  private stem: Mesh;
  private body: Mesh | null = null;
  private leaves: Group[] = [];
  private flower = new Group();
  private petals: Mesh[] = [];
  private buds: Mesh[] = [];
  private center: Mesh;
  private greenMaterial: MeshStandardMaterial;
  private leafMaterial: MeshStandardMaterial;
  private petalMaterial: MeshStandardMaterial;
  private bloomColor = new Color();
  private look: PlantLook;
  readonly species: SpeciesId;

  constructor(hue: number, species: SpeciesId = 'daisy') {
    super();
    this.name = 'TendPlant';
    this.species = species;
    const look = (this.look = LOOKS[species]);
    this.greenMaterial = new MeshStandardMaterial({ color: GREEN.clone(), roughness: 0.7 });
    this.leafMaterial = new MeshStandardMaterial({ color: DARK_GREEN.clone(), roughness: 0.6 });
    this.bloomColor.set(look.colors[hue % look.colors.length]);
    this.petalMaterial = new MeshStandardMaterial({ color: this.bloomColor.clone(), roughness: 0.5 });

    this.add(this.swayPivot);
    this.swayPivot.add(this.stemPivot);
    const stemGeometry = new CylinderGeometry(0.0035, 0.0055, 1, 8);
    stemGeometry.translate(0, 0.5, 0);
    this.stem = new Mesh(stemGeometry, this.greenMaterial);
    this.stemPivot.add(this.stem);

    if (species === 'cactus') {
      // A round, ribbed cactus body instead of a thin stem.
      this.stem.visible = false;
      const bodyGeometry = new SphereGeometry(1, 16, 12);
      bodyGeometry.translate(0, 1, 0);
      this.body = new Mesh(bodyGeometry, this.greenMaterial);
      this.stemPivot.add(this.body);
    }

    const leafGeometry = new SphereGeometry(1, 12, 8);
    for (let i = 0; i < look.leaves; i++) {
      const pivot = new Group();
      pivot.rotation.y = i * 2.4; // golden-angle spacing
      const leaf = new Mesh(leafGeometry, this.leafMaterial);
      leaf.scale.set(...look.leafScale);
      leaf.position.x = look.leafScale[0] * 0.9;
      pivot.add(leaf);
      this.stemPivot.add(pivot);
      this.leaves.push(pivot);
    }

    const petalGeometry = new SphereGeometry(1, 12, 8);
    for (let i = 0; i < look.petals; i++) {
      const pivot = new Group();
      pivot.rotation.y = (i / look.petals) * Math.PI * 2;
      const petal = new Mesh(petalGeometry, this.petalMaterial);
      petal.scale.set(...look.petalScale);
      petal.position.x = look.petalOffset;
      if (species === 'tulip') petal.position.y = look.petalScale[2] * 0.8;
      pivot.add(petal);
      this.flower.add(pivot);
      this.petals.push(petal);
    }
    if (species === 'lavender') {
      // A spike of small buds along the top of the stem.
      const budGeometry = new SphereGeometry(0.0045, 8, 6);
      for (let i = 0; i < 12; i++) {
        const bud = new Mesh(budGeometry, this.petalMaterial);
        bud.position.set(Math.cos(i * 2.4) * 0.004, -i * 0.0045, Math.sin(i * 2.4) * 0.004);
        this.flower.add(bud);
        this.buds.push(bud);
      }
    }
    this.center = new Mesh(
      new SphereGeometry(look.centerSize, 12, 8),
      new MeshStandardMaterial({ color: look.center, roughness: 0.5 }),
    );
    this.flower.add(this.center);
    this.stemPivot.add(this.flower);
    this.pose(0, 0, 0);
  }

  /** The flower colour, for effects that match it. */
  get tint(): Color {
    return this.bloomColor;
  }

  /** Height of the plant's top above the soil, in metres. */
  get topHeight(): number {
    return (0.012 + 0.15 * easeOut(this.growthNow)) * this.look.heightScale;
  }

  /** Bend the plant away from a touch, in its local x/z direction. */
  push(dx: number, dz: number, strength = 1): void {
    const len = Math.hypot(dx, dz) || 1;
    this.bendVZ -= (dx / len) * 6 * strength;
    this.bendVX += (dz / len) * 6 * strength;
  }

  /** Breeze sway plus the springy return from a touch. Call once per frame. */
  updateMotion(delta: number, time: number, calm = 1): void {
    const dt = Math.min(delta, 0.05);
    // Damped spring back to upright.
    this.bendVX += (-90 * this.bendX - 7 * this.bendVX) * dt;
    this.bendVZ += (-90 * this.bendZ - 7 * this.bendVZ) * dt;
    this.bendX += this.bendVX * dt;
    this.bendZ += this.bendVZ * dt;
    const breeze = 0.035 * calm;
    this.swayPivot.rotation.x = this.bendX + Math.sin(time * 1.3 + this.windPhase) * breeze;
    this.swayPivot.rotation.z = this.bendZ + Math.sin(time * 0.9 + this.windPhase * 1.7) * breeze * 0.8;
    for (let i = 0; i < this.leaves.length; i++) {
      this.leaves[i].rotation.x = Math.sin(time * 2.3 + this.windPhase + i) * 0.08 * calm + this.bendX * 0.6;
    }
  }

  /**
   * @param growth 0 = tiny sprout, 1 = fully grown
   * @param bloom 0 = closed bud, 1 = open flower
   * @param wilt 0 = healthy, 1 = fully drooped and brown
   */
  pose(growth: number, bloom: number, wilt: number): void {
    const look = this.look;
    this.growthNow = growth;
    const height = (0.012 + 0.15 * easeOut(growth)) * look.heightScale;
    this.stem.scale.y = height;
    if (this.body) {
      const r = 0.012 + 0.024 * easeOut(growth);
      this.body.scale.set(r, height / 2, r);
    }
    this.stemPivot.rotation.z = wilt * 0.9;

    for (let i = 0; i < this.leaves.length; i++) {
      const pivot = this.leaves[i];
      const appear = backOut(clamp01((growth - i / 7) * 5));
      pivot.position.y = height * (0.25 + 0.6 * (i / this.leaves.length));
      pivot.scale.setScalar(Math.max(appear, 0.0001));
      pivot.rotation.z = 0.45 - wilt * 1.1;
    }

    const budSize = clamp01((growth - 0.8) * 5);
    this.flower.visible = budSize > 0;
    this.flower.position.y = height;
    // Open flowers turn their faces toward the viewer (the pot's +Z side).
    this.flower.rotation.x = bloom * 0.55 * (1 - wilt);
    this.flower.scale.setScalar(
      Math.max(0.35 + 0.65 * bloom, 0.0001) * Math.max(budSize, 0.0001) * look.flowerScale,
    );
    for (const petal of this.petals) {
      // Closed bud points up; an open flower settles at its species' tilt.
      petal.parent!.rotation.z = (1 - bloom) * 1.2 + bloom * look.openTilt + wilt * -0.8;
    }
    for (let i = 0; i < this.buds.length; i++) {
      this.buds[i].visible = bloom > i / this.buds.length || growth >= 1;
    }
    this.center.visible = bloom > 0.3 && this.buds.length === 0;

    this.greenMaterial.color.copy(GREEN).lerp(WILT_BROWN, wilt);
    this.leafMaterial.color.copy(DARK_GREEN).lerp(WILT_BROWN, wilt);
    this.petalMaterial.color.copy(this.bloomColor).lerp(WILT_BROWN, wilt * 0.8);
  }
}

/** Ring of leaves around the pot that fills as the session progresses. */
export class TimeRing extends Group {
  private leaves: Mesh[] = [];
  private onMaterial: MeshStandardMaterial;
  private offMaterial: MeshStandardMaterial;
  opacity = 0;

  constructor(count = 12) {
    super();
    this.name = 'TendTimeRing';
    this.onMaterial = new MeshStandardMaterial({
      color: '#7fd36e',
      emissive: '#3c8f33',
      emissiveIntensity: 0.4,
      transparent: true,
    });
    this.offMaterial = new MeshStandardMaterial({ color: '#d8d8d8', transparent: true, opacity: 0.5 });
    const geometry = new SphereGeometry(1, 10, 6);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const leaf = new Mesh(geometry, this.offMaterial);
      leaf.scale.set(0.014, 0.003, 0.007);
      leaf.position.set(Math.sin(angle) * 0.095, 0, -Math.cos(angle) * 0.095);
      leaf.rotation.y = -angle + Math.PI / 2;
      this.add(leaf);
      this.leaves.push(leaf);
    }
    this.setOpacity(0);
  }

  setProgress(progress: number): void {
    const filled = Math.floor(progress * this.leaves.length + 1e-6);
    this.leaves.forEach((leaf, i) => {
      leaf.material = i < filled ? this.onMaterial : this.offMaterial;
    });
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
    this.visible = opacity > 0.01;
    this.onMaterial.opacity = opacity;
    this.offMaterial.opacity = opacity * 0.5;
  }

  setWarning(on: boolean): void {
    this.onMaterial.color.set(on ? '#e8806b' : '#7fd36e');
    this.onMaterial.emissive.set(on ? '#a33d2a' : '#3c8f33');
  }
}

/**
 * Text label backed by a canvas texture. It is a plane mesh rather than a
 * Sprite so ray selection works on it; call lookAt(camera) to face the viewer.
 */
export class Label extends Mesh<PlaneGeometry, MeshBasicMaterial> {
  private canvas: HTMLCanvasElement;
  private texture: CanvasTexture;
  private text = '';
  private style: { pill: boolean; highContrast: boolean };

  constructor(width: number, options: { pill?: boolean } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = options.pill ? 400 : 1024;
    canvas.height = 160;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    super(
      new PlaneGeometry(width, width * (canvas.height / canvas.width)),
      new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: DoubleSide }),
    );
    this.canvas = canvas;
    this.texture = texture;
    this.style = { pill: options.pill ?? false, highContrast: false };
    this.renderOrder = 10;
  }

  /** Larger labels with solid black backgrounds and bright text. */
  setHighContrast(on: boolean): void {
    if (on === this.style.highContrast) return;
    this.style.highContrast = on;
    this.scale.setScalar(on ? 1.35 : 1);
    const text = this.text;
    this.text = '\u0000';
    this.setText(text);
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const g = this.canvas.getContext('2d')!;
    const { width, height } = this.canvas;
    g.clearRect(0, 0, width, height);
    this.visible = text !== '';
    if (!text) {
      this.texture.needsUpdate = true;
      return;
    }
    g.font = `normal ${this.style.highContrast ? 800 : 600} 64px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
    const textWidth = Math.min(g.measureText(text).width, width - 80);
    const boxWidth = this.style.pill ? textWidth + 90 : width - 20;
    const x = (width - boxWidth) / 2;
    const contrast = this.style.highContrast;
    g.fillStyle = contrast ? '#000000' : this.style.pill ? 'rgba(60, 110, 55, 0.92)' : 'rgba(25, 30, 25, 0.78)';
    roundRect(g, x, 20, boxWidth, height - 40, (height - 40) / 2);
    g.fill();
    if (contrast) {
      g.lineWidth = 8;
      g.strokeStyle = '#ffffff';
      g.stroke();
    }
    g.fillStyle = contrast ? '#ffe14d' : '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, width / 2, height / 2 + 2, width - 80);
    this.texture.needsUpdate = true;
  }
}

/** Water drops that fall from the hand into the pot while watering. */
export class Droplets extends Group {
  private drops: Mesh[] = [];
  private phases: number[] = [];

  constructor() {
    super();
    const material = new MeshStandardMaterial({
      color: '#8fd3ff',
      emissive: '#2c7fb8',
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.85,
    });
    const geometry = new SphereGeometry(0.004, 8, 6);
    for (let i = 0; i < 7; i++) {
      const drop = new Mesh(geometry, material);
      this.add(drop);
      this.drops.push(drop);
      this.phases.push(i / 7);
    }
    this.visible = false;
  }

  /** Animate drops falling from `height` above the soil down to it. */
  animate(time: number, height: number): void {
    this.drops.forEach((drop, i) => {
      const t = (time * 1.6 + this.phases[i]) % 1;
      const angle = i * 2.4;
      drop.position.set(Math.cos(angle) * 0.02, height * (1 - t), Math.sin(angle) * 0.02);
    });
  }
}

export function createPreviewTable(): Group {
  const table = new Group();
  table.name = 'PreviewTable';
  const wood = new MeshStandardMaterial({ color: '#b58a5e', roughness: 0.8 });
  const top = new Mesh(new BoxGeometry(1.1, 0.04, 0.65), wood);
  top.position.y = 0.72;
  table.add(top);
  for (const [x, z] of [
    [-0.5, -0.27],
    [0.5, -0.27],
    [-0.5, 0.27],
    [0.5, 0.27],
  ]) {
    const leg = new Mesh(new BoxGeometry(0.05, 0.7, 0.05), wood);
    leg.position.set(x, 0.35, z);
    table.add(leg);
  }
  const floor = new Mesh(
    new CircleGeometry(3, 48),
    new MeshStandardMaterial({ color: '#d9d4c7', roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  table.add(floor);
  return table;
}

export const PREVIEW_TABLE_HEIGHT = 0.74;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Overshoots slightly before settling, so new leaves pop out. */
export function backOut(t: number): number {
  const c = 1.9;
  const x = t - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}

export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/**
 * A translucent hand that demonstrates the next gesture. Fingers point along
 * -Z and the palm faces -Y, matching a relaxed real hand held forward.
 */
export class GhostHand extends Group {
  private material: MeshStandardMaterial;
  private thumb = new Group();
  private index = new Group();
  private others: Group[] = [];

  constructor() {
    super();
    this.name = 'TendGhostHand';
    this.material = new MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#bfe6b8',
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const palm = new Mesh(new SphereGeometry(1, 16, 10), this.material);
    palm.scale.set(0.038, 0.012, 0.045);
    this.add(palm);

    const finger = (length: number) => {
      const geometry = new CapsuleGeometry(0.0075, length, 4, 8);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, -length / 2 - 0.0075);
      return new Mesh(geometry, this.material);
    };
    // Index finger at the thumb side, then middle, ring and little fingers.
    this.index.position.set(-0.024, 0, -0.04);
    this.index.add(finger(0.06));
    this.add(this.index);
    [-0.008, 0.008, 0.023].forEach((x, i) => {
      const pivot = new Group();
      pivot.position.set(x, 0, -0.042 + i * 0.004);
      pivot.add(finger(0.062 - i * 0.008));
      pivot.rotation.x = -0.25;
      this.add(pivot);
      this.others.push(pivot);
    });
    this.thumb.position.set(-0.035, -0.004, -0.005);
    this.thumb.rotation.y = 0.75;
    this.thumb.add(finger(0.045));
    this.add(this.thumb);
    this.visible = false;
  }

  /** @param pinch 0 = open hand, 1 = thumb and index touching */
  setPinch(pinch: number): void {
    this.index.rotation.x = -0.15 - pinch * 0.9;
    this.index.rotation.y = pinch * -0.25;
    this.thumb.rotation.x = -pinch * 0.55;
    this.thumb.rotation.y = 0.75 - pinch * 0.35;
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity * 0.45;
    this.visible = opacity > 0.01;
  }
}

/** Small arrow that floats in view and points toward the pot when it is out of sight. */
export function createFinderArrow(): Group {
  const arrow = new Group();
  arrow.name = 'TendFinderArrow';
  const material = new MeshStandardMaterial({
    color: '#7fd36e',
    emissive: '#3c8f33',
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.9,
  });
  const head = new Mesh(new ConeGeometry(0.018, 0.04, 16), material);
  head.rotation.x = Math.PI / 2; // point along +Z, the axis Object3D.lookAt aims
  head.position.z = 0.03;
  arrow.add(head);
  const shaft = new Mesh(new CylinderGeometry(0.006, 0.006, 0.04, 8), material);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.01;
  arrow.add(shaft);
  arrow.visible = false;
  return arrow;
}
