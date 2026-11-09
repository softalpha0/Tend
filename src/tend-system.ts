import {
  Color,
  createSystem,
  Entity,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Pressed,
  Quaternion,
  RayInteractable,
  SphereGeometry,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { PotAnchor } from './anchor.js';
import { Burst, Butterfly, Motes, Ripples } from './effects.js';
import { anyHandTracked, handList, HandState } from './hands.js';
import {
  clamp01,
  createPot,
  createPreviewTable,
  createFinderArrow,
  createSeed,
  Droplets,
  GhostHand,
  Label,
  Plant,
  POT_HEIGHT,
  PREVIEW_TABLE_HEIGHT,
  SOIL_Y,
  TimeRing,
} from './models.js';
import { setAmbient, sounds, speak } from './sound.js';
import { nextUnlock, seasonalSpecies, SPECIES, speciesById, unlockedSpecies } from './species.js';
import {
  currentStreak,
  DURATION_CHOICES,
  formatMinutes,
  weekSummary,
  localDay,
  loadState,
  saveState,
  STARTER_MINUTES,
  testMinutesOverride,
  TendState,
} from './state.js';
import { TargetRole, TendTarget } from './tend-components.js';
import { VoiceCommand, VoiceCommands } from './voice.js';
import { fetchGardens, MAX_LIVE_FRIENDS, normalizeCode, publishGarden, syncConfig } from './sync.js';

// Desk detection: horizontal surfaces between these heights count as a desk.
const DESK_MIN_HEIGHT = 0.45;
const DESK_MAX_HEIGHT = 1.3;
/** Typical desk and table heights; lower surfaces are often couches or coffee tables. */
const DESK_TYPICAL_MIN = 0.62;
const DESK_TYPICAL_MAX = 1.1;
const NOT_A_DESK = ['couch', 'bed', 'floor', 'ceiling', 'shelf', 'storage'];
/** Wait this long after the first desk candidate so more planes can arrive. */
const DESK_SETTLE_S = 1.2;
/** Give up on plane detection and place the pot in front of the user. */
const DESK_TIMEOUT_S = 6;
/** Keep the pot at least this far from the desk edge. */
const DESK_EDGE_MARGIN = 0.2;

// Gesture distances in metres.
// Generous so the gestures work without precise aim.
const SEED_GRAB_RADIUS = 0.09;
const POT_GRAB_RADIUS = 0.1;
const PLANT_DROP_RADIUS = 0.1;
const WATER_RADIUS = 0.2;
const CHIP_RADIUS = 0.05;
const WATER_HOLD_S = 1.2;
const GIVE_UP_HOLD_S = 2;
/** A near pinch this close to a target suppresses the ray-select fallback. */
const NEAR_HAND_RADIUS = 0.2;

const BLOOM_SHOW_MS = 7000;
const WILT_SHOW_MS = 5000;
const GARDEN_MAX = 10;
const SAVE_EVERY_MS = 5000;

/** The seed floats at the front left of the pot; the garden fills the sides and back. */
const SEED_HOME = new Vector3(-0.1, 0.12, 0.07);
/** Where the ghost hand's pinch point sits relative to the hand origin. */
const GHOST_PINCH = new Vector3(-0.03, -0.01, -0.095);
/** Show the finder arrow when the pot is more than this far from the view centre (radians). */
const FINDER_ANGLE = 0.8;
const SPEAK_TIME_EVERY_MS = 8000;
/** A gap longer than this between present frames counts as the user stepping away. */
const PAUSE_GAP_MS = 2000;
/** Wait this long for a restored anchor to be located before using desk detection. */
const ANCHOR_WAIT_S = 4;
// Labels sit low and close to the pot so they stay inside a narrow field of view.
const CHIP_POSITION = new Vector3(0.13, 0.05, 0.03);
const SPECIES_CHIP_POSITION = new Vector3(-0.15, 0.03, 0.0);
const HINT_POSITION = new Vector3(0, 0.02, 0.14);

type Held =
  | { kind: 'seed'; hand: HandState }
  | { kind: 'pot'; hand: HandState; offset: Vector3 }
  | null;


export class TendSystem extends createSystem({
  planes: { required: [XRPlane] },
  pressed: { required: [TendTarget, Pressed] },
}) {
  private state!: TendState;
  private testMinutes: number | null = null;

  private root!: Group;
  private rootEntity!: Entity;
  private potEntity!: Entity;
  private seedEntity!: Entity;
  private durationEntity!: Entity;
  private seed!: Object3D;
  private seedGlow!: Mesh;
  private plant!: Plant;
  private ring!: TimeRing;
  private hint!: Label;
  private chip!: Label;
  private speciesChip!: Label;
  private speciesEntity!: Entity;
  private seedBody!: Mesh<SphereGeometry, MeshStandardMaterial>;
  private friendsGroup!: Group;
  private friendLabels: Label[] = [];
  // Living garden: effects, butterflies and plants that respond to touch.
  private motes!: Motes;
  private burst!: Burst;
  private sparkle!: Burst;
  private ripples!: Ripples;
  private butterflyGroup!: Group;
  private butterflies: { fly: Butterfly; nextMove: number; onHand: boolean }[] = [];
  private gardenPlants: Plant[] = [];
  private friendPlants: Plant[] = [];
  private touchable: Plant[] = [];
  private lastTouch = new WeakMap<Plant, number>();
  private lastRustleSound = 0;
  private handHolding: HandState | null = null;
  private scratchScale = new Vector3();
  private tipLocal = new Vector3();
  private unlockMessage = '';
  private droplets!: Droplets;
  private garden!: Group;
  private table!: Group;
  private ghost!: GhostHand;
  private ghostOpacity = 0;
  private finder!: Group;
  private ambientOn = false;
  private wasPalmUp = false;
  private lastSpokenTime = 0;
  private potAnchor = new PotAnchor();
  private anchorState: 'none' | 'restoring' | 'restored' = 'none';
  private anchorDirty = false;
  private anchorQuat = new Quaternion();
  private voice!: VoiceCommands;

  // Desk placement for the current XR session.
  private immersive = false;
  private placed = false;
  private desk: Object3D | null = null;
  private deskPolygon: { x: number; z: number }[] = [];
  private xrStartTime = 0;
  private firstCandidateTime = -1;

  // Interaction state.
  private held: Held = null;
  private giveUp: { hand: HandState; start: number } | null = null;
  private waterHold = 0;
  private ringFlashUntil = 0;
  private hintUntil = 0;
  private resumedUntil = 0;
  private summaryUntil = 0;
  private sync = syncConfig();
  private publishTimer = 0;
  private halfwayPlayed = false;
  private twoMinutesPlayed = false;
  private lastSave = 0;
  private clock = 0;

  // Scratch vectors, allocated once.
  private rootWorld = new Vector3();
  private potCenter = new Vector3();
  private soilWorld = new Vector3();
  private seedWorld = new Vector3();
  private chipWorld = new Vector3();
  private speciesChipWorld = new Vector3();
  private headWorld = new Vector3();
  private headForward = new Vector3();
  private temp2Matrix = new Matrix4();
  private temp = new Vector3();
  private temp2 = new Vector3();

  init(): void {
    this.state = loadState();
    this.testMinutes = testMinutesOverride();
    this.buildScene();

    // A bloom or wilt that was showing when the app closed is finished.
    if (this.state.phase === 'bloomed' || this.state.phase === 'wilted') {
      this.state.phase = 'empty';
    }
    this.resetCues();
    this.replacePlant();
    this.rebuildGarden();
    this.rebuildFriends();
    this.applyContrast(this.state.highContrast);
    this.voice = new VoiceCommands((command) => this.onVoice(command));
    if (import.meta.env.DEV) {
      // Lets local scripts (demo recording, tests) find the pot. Not in production builds.
      (window as unknown as { __tendRoot?: Group }).__tendRoot = this.root;
    }
    this.syncVisuals();

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (entity) => this.onPressed(entity)),
      this.world.visibilityState.subscribe((visibility) => this.onVisibility(visibility)),
    );
    const onSettings = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          ambient?: boolean;
          spoken?: boolean;
          highContrast?: boolean;
          voice?: boolean;
          name?: string;
          clearFriends?: boolean;
          addFriendCode?: string;
        }>
      ).detail;
      if (detail.ambient !== undefined) this.state.ambient = detail.ambient;
      if (detail.spoken !== undefined) this.state.spoken = detail.spoken;
      if (detail.highContrast !== undefined) this.applyContrast(detail.highContrast);
      if (detail.name !== undefined && detail.name !== this.state.name) {
        this.state.name = detail.name;
        this.publishSoon();
      }
      if (detail.clearFriends) {
        this.state.friends = [];
        this.state.friendCodes = [];
        this.rebuildFriends();
      }
      if (detail.addFriendCode) this.followCode(detail.addFriendCode);
      if (detail.voice !== undefined) {
        this.state.voice = detail.voice;
        this.voice.setEnabled(detail.voice);
      }
      saveState(this.state);
    };
    window.addEventListener('tend-settings', onSettings);
    this.cleanupFuncs.push(() => window.removeEventListener('tend-settings', onSettings));
    if (this.sync) {
      // Live shared gardens: publish ours, then keep friends' gardens fresh.
      this.publishSoon();
      void this.refreshFriends();
      const timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void this.refreshFriends();
      }, 60_000);
      this.cleanupFuncs.push(() => window.clearInterval(timer));
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveState(this.state);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    this.cleanupFuncs.push(
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('pagehide', onHide),
    );
  }

  private buildScene(): void {
    this.table = createPreviewTable();
    this.world.createTransformEntity(this.table, { persistent: true });

    this.root = new Group();
    this.root.name = 'TendRoot';
    this.rootEntity = this.world.createTransformEntity(this.root, { persistent: true });

    const pot = createPot();
    this.potEntity = this.world.createTransformEntity(pot, { parent: this.rootEntity, persistent: true });
    this.potEntity.addComponent(RayInteractable);
    this.potEntity.addComponent(TendTarget, { role: TargetRole.Pot });

    const { seed, glow, body } = createSeed();
    this.seed = seed;
    this.seedGlow = glow;
    this.seedBody = body;
    seed.position.copy(SEED_HOME);
    this.seedEntity = this.world.createTransformEntity(seed, { parent: this.rootEntity, persistent: true });
    this.seedEntity.addComponent(RayInteractable);
    this.seedEntity.addComponent(TendTarget, { role: TargetRole.Seed });

    this.chip = new Label(0.09, { pill: true });
    this.chip.position.copy(CHIP_POSITION);
    this.durationEntity = this.world.createTransformEntity(this.chip, {
      parent: this.rootEntity,
      persistent: true,
    });
    this.durationEntity.addComponent(RayInteractable);
    this.durationEntity.addComponent(TendTarget, { role: TargetRole.Duration });

    this.speciesChip = new Label(0.09, { pill: true });
    this.speciesChip.position.copy(SPECIES_CHIP_POSITION);
    this.speciesEntity = this.world.createTransformEntity(this.speciesChip, {
      parent: this.rootEntity,
      persistent: true,
    });
    this.speciesEntity.addComponent(RayInteractable);
    this.speciesEntity.addComponent(TendTarget, { role: TargetRole.Species });

    this.friendsGroup = new Group();
    this.root.add(this.friendsGroup);

    this.hint = new Label(0.3);
    this.hint.position.copy(HINT_POSITION);
    this.root.add(this.hint);

    this.ring = new TimeRing();
    this.ring.position.y = POT_HEIGHT + 0.005;
    this.root.add(this.ring);

    this.droplets = new Droplets();
    this.droplets.position.y = SOIL_Y;
    this.root.add(this.droplets);

    this.garden = new Group();
    this.root.add(this.garden);

    this.ghost = new GhostHand();
    this.root.add(this.ghost);

    this.motes = new Motes();
    this.motes.position.y = SOIL_Y;
    this.root.add(this.motes);
    this.burst = new Burst(150);
    this.sparkle = new Burst(24);
    this.root.add(this.burst, this.sparkle);
    this.ripples = new Ripples();
    this.ripples.position.y = SOIL_Y + 0.001;
    this.root.add(this.ripples);
    this.butterflyGroup = new Group();
    this.root.add(this.butterflyGroup);

    this.finder = createFinderArrow();
    this.world.createTransformEntity(this.finder, { persistent: true });

    this.placeOnPreviewTable();
  }

  // ---------------------------------------------------------------------------
  // Placement

  private onVisibility(visibility: VisibilityState): void {
    const immersive = visibility !== VisibilityState.NonImmersive;
    if (immersive === this.immersive) return;
    this.immersive = immersive;
    this.dropHeld();
    if (immersive) {
      this.placed = false;
      this.desk = null;
      this.anchorState = 'restoring';
      void this.potAnchor.restore(this.world.session).then((ok) => {
        this.anchorState = ok ? 'restored' : 'none';
      });
      if (this.state.voice) this.voice.setEnabled(true);
      if (this.sync) void this.refreshFriends();
      this.xrStartTime = this.clock;
      this.firstCandidateTime = -1;
      this.table.visible = false;
      this.scene.background = null;
      this.hintUntil = 0;
    } else {
      this.potAnchor.endSession();
      this.anchorState = 'none';
      this.placeOnPreviewTable();
    }
  }

  /**
   * Place the pot for this XR session: at its saved anchor if the headset
   * still knows it, otherwise on the detected desk.
   */
  private tryPlace(): void {
    const waited = this.clock - this.xrStartTime;
    if (this.anchorState === 'restoring' && waited < ANCHOR_WAIT_S) return;
    if (this.anchorState === 'restored') {
      if (this.followAnchor()) {
        this.placed = true;
        console.info('[Tend] pot restored from its saved anchor');
        return;
      }
      if (waited < ANCHOR_WAIT_S) return;
    }
    this.tryPlaceOnDesk();
    if (this.placed) this.anchorDirty = true;
  }

  /** Moves the pot to its anchor's pose. Returns false if the anchor isn't tracked. */
  private followAnchor(): boolean {
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    if (!frame || !space) return false;
    if (!this.potAnchor.read(frame, space, this.temp, this.anchorQuat)) return false;
    // Anchor poses are in reference space; the player rig maps that to world space.
    this.player.updateMatrixWorld();
    this.root.position.copy(this.temp).applyMatrix4(this.player.matrixWorld);
    this.player.getWorldQuaternion(this.root.quaternion).multiply(this.anchorQuat);
    return true;
  }

  /** Saves a new anchor at the pot's current pose. */
  private saveAnchor(): void {
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    if (!frame || !space) return;
    this.player.updateMatrixWorld();
    this.temp.copy(this.root.position).applyMatrix4(this.temp2Matrix.copy(this.player.matrixWorld).invert());
    this.player.getWorldQuaternion(this.anchorQuat).invert().multiply(this.root.quaternion);
    this.potAnchor.save(frame, space, this.temp, this.anchorQuat);
    this.anchorDirty = false;
  }

  /** After restoring from an anchor, find the desk under the pot so it can still slide along it. */
  private findDeskUnderPot(): void {
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const object = entity.object3D;
      if (!plane || !object || plane.orientation !== 'horizontal') continue;
      object.getWorldPosition(this.temp);
      if (Math.abs(this.temp.y - this.root.position.y) > 0.05) continue;
      this.desk = object;
      this.deskPolygon = plane.polygon.map((p) => ({ x: p.x, z: p.z }));
      return;
    }
  }

  private placeOnPreviewTable(): void {
    this.table.visible = true;
    this.scene.background = new Color('#e8eee6');
    this.desk = null;
    this.placed = true;
    this.root.position.set(0, PREVIEW_TABLE_HEIGHT, -0.45);
    this.root.rotation.set(0, 0, 0);
    this.camera.position.set(0, 1.08, 0.3);
    this.camera.lookAt(0, PREVIEW_TABLE_HEIGHT + 0.14, -0.45);
  }

  private tryPlaceOnDesk(): void {
    const elapsed = this.clock - this.xrStartTime;
    this.player.head.getWorldPosition(this.headWorld);
    this.horizontalForward(this.headForward);

    let best: Object3D | null = null;
    let bestScore = Infinity;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const object = entity.object3D;
      if (!plane || !object || plane.orientation !== 'horizontal') continue;
      object.getWorldPosition(this.temp);
      if (this.temp.y < DESK_MIN_HEIGHT || this.temp.y > DESK_MAX_HEIGHT) continue;
      const label = (plane as XRPlane & { semanticLabel?: string }).semanticLabel ?? '';
      if (NOT_A_DESK.includes(label)) continue;
      let score = Math.hypot(this.temp.x - this.headWorld.x, this.temp.z - this.headWorld.z);
      if (label === 'table' || label === 'desk') score -= 3;
      if (this.temp.y < DESK_TYPICAL_MIN || this.temp.y > DESK_TYPICAL_MAX) score += 1.5;
      // Prefer the surface the user is facing.
      this.temp2.set(this.temp.x - this.headWorld.x, 0, this.temp.z - this.headWorld.z);
      if (this.temp2.lengthSq() > 1e-4) score += this.temp2.normalize().angleTo(this.headForward) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = object;
        this.deskPolygon = plane.polygon.map((p) => ({ x: p.x, z: p.z }));
      }
    }

    if (best && this.firstCandidateTime < 0) this.firstCandidateTime = this.clock;
    const settled = best && this.clock - this.firstCandidateTime > DESK_SETTLE_S;
    if (best && settled) {
      best.getWorldPosition(this.temp);
      console.info(`[Tend] desk chosen at height ${this.temp.y.toFixed(2)} m`);
      this.desk = best;
      this.placeOnDesk();
    } else if (elapsed > DESK_TIMEOUT_S) {
      this.placeInFrontOfUser();
    }
  }

  private placeOnDesk(): void {
    const desk = this.desk!;
    desk.updateMatrixWorld(true);
    let local: { x: number; z: number } | null = null;
    const saved = this.state.deskOffset;
    if (saved && this.insideDesk(saved[0], saved[1], DESK_EDGE_MARGIN * 0.5)) {
      local = { x: saved[0], z: saved[1] };
    } else {
      local = this.defaultDeskSpot();
    }
    this.temp.set(local.x, 0, local.z);
    desk.localToWorld(this.temp);
    this.root.position.copy(this.temp);
    this.faceUser();
    this.placed = true;
  }

  /** Walk from the desk centre toward the user and stop near the front edge. */
  private defaultDeskSpot(): { x: number; z: number } {
    const desk = this.desk!;
    let cx = 0;
    let cz = 0;
    for (const p of this.deskPolygon) {
      cx += p.x;
      cz += p.z;
    }
    cx /= Math.max(this.deskPolygon.length, 1);
    cz /= Math.max(this.deskPolygon.length, 1);
    this.temp.copy(this.headWorld);
    desk.worldToLocal(this.temp);
    for (let t = 1; t >= 0; t -= 0.05) {
      const x = cx + (this.temp.x - cx) * t;
      const z = cz + (this.temp.z - cz) * t;
      if (this.insideDesk(x, z, DESK_EDGE_MARGIN)) return { x, z };
    }
    return { x: cx, z: cz };
  }

  private insideDesk(x: number, z: number, margin: number): boolean {
    const poly = this.deskPolygon;
    if (poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
        inside = !inside;
      }
    }
    if (!inside) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (distanceToSegment(x, z, poly[j], poly[i]) < margin) return false;
    }
    return true;
  }

  /** The direction the user is looking, flattened onto the floor. */
  private horizontalForward(out: Vector3): Vector3 {
    // Object3D.getWorldDirection returns +Z; the head looks down -Z.
    this.player.head.getWorldDirection(out).negate();
    out.y = 0;
    if (out.lengthSq() < 1e-4) out.set(0, 0, -1);
    return out.normalize();
  }

  private placeInFrontOfUser(): void {
    this.player.head.getWorldPosition(this.headWorld);
    this.horizontalForward(this.temp).multiplyScalar(0.45);
    this.root.position.set(
      this.headWorld.x + this.temp.x,
      Math.max(this.headWorld.y - 0.55, 0.5),
      this.headWorld.z + this.temp.z,
    );
    this.faceUser();
    this.placed = true;
  }

  private faceUser(): void {
    this.player.head.getWorldPosition(this.headWorld);
    this.root.rotation.set(
      0,
      Math.atan2(this.headWorld.x - this.root.position.x, this.headWorld.z - this.root.position.z),
      0,
    );
  }

  // ---------------------------------------------------------------------------
  // Main loop

  private loggedPhase = '';

  update(delta: number): void {
    this.clock += delta;
    const now = Date.now();
    if (import.meta.env.DEV && this.loggedPhase !== this.state.phase) {
      this.loggedPhase = this.state.phase;
      console.info(`[Tend] phase ${this.state.phase}`);
    }

    if (this.immersive && !this.placed) {
      this.tryPlace();
    } else if (this.immersive && this.placed) {
      if (this.anchorDirty) this.saveAnchor();
      // Follow the anchor so the pot stays put as tracking corrects itself.
      if (this.held?.kind !== 'pot' && this.potAnchor.active) this.followAnchor();
      if (!this.desk && this.anchorState === 'restored') this.findDeskUnderPot();
    }

    this.updatePresence(now);
    this.updateSession(now);

    this.root.updateMatrixWorld(true);
    this.root.getWorldPosition(this.rootWorld);
    this.potCenter.set(0, POT_HEIGHT / 2, 0);
    this.root.localToWorld(this.potCenter);
    this.soilWorld.set(0, SOIL_Y, 0);
    this.root.localToWorld(this.soilWorld);

    if (this.immersive && this.placed) {
      this.updateHands(delta, now);
    }
    this.updateSound(now);
    this.syncVisuals(now);
    this.updateGhost();
    this.updateLife(delta, now);
    this.updateFinder();
  }

  private updatePresence(now: number): void {
    if (this.state.phase !== 'growing') return;
    const visibility = this.world.visibilityState.peek();
    const present =
      visibility === VisibilityState.Visible ||
      (visibility === VisibilityState.NonImmersive && document.visibilityState === 'visible');
    if (!present) return;
    // Time away (headset off, menu open, app closed) pauses the session.
    const gap = now - this.state.lastSeen;
    if (gap > PAUSE_GAP_MS) {
      this.state.startedAt += gap;
      if (gap > 10_000) this.resumedUntil = now + 5000;
    }
    this.state.lastSeen = now;
    if (now - this.lastSave > SAVE_EVERY_MS) {
      this.lastSave = now;
      saveState(this.state);
    }
  }

  private updateSession(now: number): void {
    const s = this.state;
    if (s.phase === 'growing') {
      const progress = this.progress(now);
      const remaining = s.startedAt + s.durationMs - now;
      if (!this.halfwayPlayed && progress >= 0.5) {
        this.halfwayPlayed = true;
        sounds.halfway();
        if (s.spoken) speak('Halfway there.');
      }
      if (!this.twoMinutesPlayed && remaining <= 120_000) {
        this.twoMinutesPlayed = true;
        sounds.twoMinutes();
        if (s.spoken) speak('Two minutes left.');
      }
      if (progress >= 1) this.complete(now);
    } else if (s.phase === 'bloomed' && now - s.phaseAt > BLOOM_SHOW_MS) {
      this.rebuildGarden();
      this.toEmpty();
    } else if (s.phase === 'wilted' && now - s.phaseAt > WILT_SHOW_MS) {
      this.toEmpty();
    }
  }

  private updateHands(delta: number, now: number): void {
    const phase = this.state.phase;
    this.seed.getWorldPosition(this.seedWorld);
    this.chip.getWorldPosition(this.chipWorld);
    this.speciesChip.getWorldPosition(this.speciesChipWorld);

    for (const hand of handList) {
      if (!hand.pinchStart || this.held) continue;
      if (phase === 'empty' && hand.pinchPoint.distanceTo(this.seedWorld) < SEED_GRAB_RADIUS) {
        this.held = { kind: 'seed', hand };
        sounds.pickUp();
      } else if (
        phase === 'empty' &&
        this.speciesChip.visible &&
        hand.pinchPoint.distanceTo(this.speciesChipWorld) < CHIP_RADIUS
      ) {
        this.cycleSpecies();
      } else if (
        (phase === 'empty' || phase === 'planted') &&
        this.chip.visible &&
        hand.pinchPoint.distanceTo(this.chipWorld) < CHIP_RADIUS
      ) {
        this.cycleDuration();
      } else if (
        (phase === 'empty' || phase === 'planted') &&
        hand.pinchPoint.distanceTo(this.potCenter) < POT_GRAB_RADIUS
      ) {
        this.held = { kind: 'pot', hand, offset: this.rootWorld.clone().sub(hand.pinchPoint) };
        this.potAnchor.release();
      } else if (phase === 'growing' && hand.pinchPoint.distanceTo(this.potCenter) < POT_GRAB_RADIUS * 1.3) {
        this.giveUp = { hand, start: this.clock };
      }
    }

    this.updateHeld();
    this.updateGiveUp(now);
    this.updateWatering(delta, now);

    const palmUp = handList.some((h) => h.palmUp);
    if (palmUp && !this.wasPalmUp && phase === 'empty' && this.state.garden.length > 0) {
      this.summaryUntil = now + 5000;
      if (this.state.spoken) speak(this.weekText(now));
    }
    if (palmUp && !this.wasPalmUp && phase === 'growing') {
      if (!this.state.learned.time) {
        this.state.learned.time = true;
        saveState(this.state);
      }
      if (this.state.spoken && now - this.lastSpokenTime > SPEAK_TIME_EVERY_MS) {
        this.lastSpokenTime = now;
        speak(spokenRemaining(this.state.startedAt + this.state.durationMs - now));
      }
    }
    this.wasPalmUp = palmUp;
  }

  /** Ambient bed plays during a session while the user is present. */
  private updateSound(now: number): void {
    const visibility = this.world.visibilityState.peek();
    const present = visibility === VisibilityState.Visible || visibility === VisibilityState.NonImmersive;
    const want = this.state.ambient && this.state.phase === 'growing' && present && now > 0;
    if (want !== this.ambientOn) {
      this.ambientOn = want;
      setAmbient(want);
    }
  }

  /** Plants sway and react to touch; motes, ripples, bursts and butterflies animate. */
  private updateLife(delta: number, now: number): void {
    const t = this.clock;
    const s = this.state;
    if (!this.droplets.visible) this.ripples.active = false;

    this.touchable.length = 0;
    if (this.plant.visible) this.touchable.push(this.plant);
    for (const p of this.gardenPlants) this.touchable.push(p);
    for (const p of this.friendPlants) this.touchable.push(p);
    const wilting = s.phase === 'wilted' ? 0.2 : 1;
    for (const p of this.touchable) p.updateMotion(delta, t, p === this.plant ? wilting : 1);

    // Brushing a plant with a fingertip makes it bend away and spring back.
    if (this.immersive) {
      for (const hand of handList) {
        if (!hand.tracked) continue;
        for (const p of this.touchable) this.touchPlant(p, hand.indexTip, now);
      }
    }

    const growing = s.phase === 'growing';
    this.motes.update(t, growing ? 0.25 + 0.75 * this.progress(now) : 0);
    this.ripples.update(t);
    this.burst.update(delta);
    this.sparkle.update(delta);
    this.updateButterflies(delta, now);
  }

  private touchPlant(p: Plant, tip: Vector3, now: number): void {
    p.getWorldPosition(this.temp2);
    p.getWorldScale(this.scratchScale);
    const scale = this.scratchScale.x;
    const dx = tip.x - this.temp2.x;
    const dz = tip.z - this.temp2.z;
    const dy = tip.y - this.temp2.y;
    const reach = 0.035 * scale + 0.015;
    // Includes the flower head above the stem top.
    if (dx * dx + dz * dz > reach * reach || dy < 0 || dy > p.topHeight * scale + 0.045) return;
    if (now - (this.lastTouch.get(p) ?? 0) < 450) return;
    this.lastTouch.set(p, now);
    this.tipLocal.copy(tip);
    p.worldToLocal(this.tipLocal);
    p.push(this.tipLocal.x, this.tipLocal.z, 1);
    if (import.meta.env.DEV) console.info(`[Tend] touched a ${p.species}`);
    this.tipLocal.copy(tip);
    this.root.worldToLocal(this.tipLocal);
    this.sparkle.trigger(this.tipLocal, p.tint, 0.25);
    if (now - this.lastRustleSound > 250) {
      this.lastRustleSound = now;
      sounds.rustle();
    }
  }

  /** One butterfly per streak day (up to 3), once there is a garden. */
  private wantedButterflies(now: number): number {
    if (this.state.garden.length === 0) return 0;
    return Math.min(3, Math.max(1, currentStreak(this.state, now)));
  }

  private spawnButterfly(at: Vector3): void {
    if (this.butterflies.length >= 3) return;
    const fly = new Butterfly(this.state.garden.length + this.butterflies.length);
    fly.position.copy(at);
    fly.target.copy(at).add(new Vector3(0.05, 0.08, 0.02));
    this.butterflyGroup.add(fly);
    this.butterflies.push({ fly, nextMove: this.clock + 2, onHand: false });
  }

  /** A flower top to visit, in root space. */
  private randomFlower(out: Vector3): Vector3 {
    const options = this.gardenPlants.length ? this.gardenPlants : [this.plant];
    const p = options[Math.floor(Math.random() * options.length)];
    out.set(0, p.topHeight + 0.006, 0);
    p.localToWorld(out);
    return this.root.worldToLocal(out);
  }

  private updateButterflies(delta: number, now: number): void {
    const wanted = this.wantedButterflies(now);
    while (this.butterflies.length < wanted) {
      this.randomFlower(this.temp);
      this.spawnButterfly(this.temp);
    }
    while (this.butterflies.length > wanted) {
      const gone = this.butterflies.pop()!;
      this.butterflyGroup.remove(gone.fly);
    }

    // Hold a palm up (outside a session) and the nearest butterfly lands on it.
    let palm: HandState | null = null;
    if (this.immersive && this.state.phase !== 'growing') {
      palm = handList.find((h) => h.palmUp) ?? null;
    }
    if (palm !== this.handHolding) {
      for (const b of this.butterflies) {
        if (b.onHand) {
          b.onHand = false;
          b.fly.resting = false;
          b.nextMove = 0;
        }
      }
      this.handHolding = palm;
      if (palm && this.butterflies.length) {
        this.tipLocal.copy(palm.palmCenter);
        this.root.worldToLocal(this.tipLocal);
        let nearest = this.butterflies[0];
        for (const b of this.butterflies) {
          if (b.fly.position.distanceTo(this.tipLocal) < nearest.fly.position.distanceTo(this.tipLocal)) nearest = b;
        }
        nearest.onHand = true;
        nearest.fly.resting = false;
      }
    }

    const growing = this.state.phase === 'growing';
    for (const b of this.butterflies) {
      if (b.onHand && palm) {
        b.fly.target.copy(palm.palmCenter);
        b.fly.target.y += 0.015;
        this.root.worldToLocal(b.fly.target);
        const arriving = b.fly.position.distanceTo(b.fly.target) < 0.02;
        if (arriving && !b.fly.resting) {
          b.fly.resting = true;
          sounds.land();
          if (import.meta.env.DEV) console.info('[Tend] butterfly landed on hand');
        }
      } else if (this.clock > b.nextMove) {
        // Visit another flower; calmer and less often during a focus session.
        this.randomFlower(b.fly.target);
        b.fly.resting = false;
        b.nextMove = this.clock + (growing ? 18 + Math.random() * 14 : 5 + Math.random() * 6);
      } else if (!b.fly.resting && b.fly.position.distanceTo(b.fly.target) < 0.012) {
        b.fly.resting = true;
      }
      b.fly.update(delta, this.clock);
    }
  }

  /** Ghost hand demonstrates each gesture until the user has done it once. */
  private updateGhost(): void {
    const s = this.state;
    let target = 0;
    const t = this.clock;
    if (this.immersive && this.placed && !this.held) {
      if (s.phase === 'empty' && !s.learned.plant) {
        target = this.ghostPlantDemo(t % 3.4);
      } else if (s.phase === 'planted' && !s.learned.water && this.waterHold === 0) {
        target = 1;
        this.ghost.rotation.set(0, 0, Math.PI);
        this.ghost.setPinch(0);
        this.ghost.position.set(0, SOIL_Y + 0.08 + Math.sin(t * 2) * 0.01, 0.01);
      } else if (s.phase === 'growing' && !s.learned.time && Date.now() < this.hintUntil) {
        target = 1;
        const flip = clamp01((Math.sin(t * 2.2) + 1) / 2);
        this.ghost.rotation.set(0, 0, Math.PI * flip);
        this.ghost.setPinch(0);
        this.ghost.position.set(-0.14, 0.12, 0.05);
      }
    }
    this.ghostOpacity += (target - this.ghostOpacity) * 0.12;
    this.ghost.setOpacity(this.ghostOpacity);
  }

  /** One loop of "pinch the seed, carry it to the pot, let go". Returns opacity. */
  private ghostPlantDemo(t: number): number {
    const seedAt = this.temp.copy(SEED_HOME);
    const soilAt = this.temp2.set(0, SOIL_Y + 0.03, 0);
    this.ghost.rotation.set(0, 0, 0);
    let pinch = 0;
    let travel = 0;
    let lift = 0.05;
    if (t < 0.9) {
      lift = 0.05 * (1 - t / 0.9);
    } else if (t < 1.2) {
      lift = 0;
      pinch = (t - 0.9) / 0.3;
    } else if (t < 2.3) {
      lift = 0;
      pinch = 1;
      travel = smooth((t - 1.2) / 1.1);
    } else if (t < 2.6) {
      lift = 0;
      travel = 1;
      pinch = 1 - (t - 2.3) / 0.3;
    } else {
      travel = 1;
      lift = (t - 2.6) * 0.06;
    }
    this.ghost.setPinch(pinch);
    this.ghost.position.copy(seedAt).lerp(soilAt, travel).sub(GHOST_PINCH);
    this.ghost.position.y += lift;
    return t < 0.25 ? t / 0.25 : t > 2.8 ? Math.max(0, (3.4 - t) / 0.6) : 1;
  }

  /** Arrow in front of the user pointing at the pot when it is out of view. */
  private updateFinder(): void {
    if (!this.immersive || !this.placed) {
      this.finder.visible = false;
      return;
    }
    this.player.head.getWorldPosition(this.headWorld);
    this.player.head.getWorldDirection(this.headForward).negate();
    this.temp.copy(this.potCenter).sub(this.headWorld).normalize();
    const off = this.temp.angleTo(this.headForward);
    this.finder.visible = off > FINDER_ANGLE;
    if (!this.finder.visible) return;
    this.finder.position.copy(this.headWorld).addScaledVector(this.headForward, 0.5);
    this.finder.position.y -= 0.08;
    this.finder.lookAt(this.potCenter);
  }

  private updateHeld(): void {
    const held = this.held;
    if (!held) return;
    // Follow the hand only while pinched: the pinch point jumps as the hand opens.
    if (held.kind === 'seed') {
      if (held.hand.pinching) {
        this.temp.copy(held.hand.pinchPoint);
        this.root.worldToLocal(this.temp);
        this.seed.position.copy(this.temp);
      }
      if (held.hand.pinchEnd) {
        this.seed.getWorldPosition(this.seedWorld);
        this.held = null;
        if (this.seedWorld.distanceTo(this.soilWorld) < PLANT_DROP_RADIUS) {
          this.plantSeed();
        }
      }
    } else if (held.hand.pinching) {
      this.temp.copy(held.hand.pinchPoint).add(held.offset);
      if (this.desk) {
        // Slide along the desk surface.
        this.root.position.x = this.temp.x;
        this.root.position.z = this.temp.z;
      } else {
        this.root.position.copy(this.temp);
      }
    } else {
      if (held.hand.pinchEnd) {
        this.held = null;
        this.faceUser();
        this.anchorDirty = true;
        if (this.desk) {
          this.temp.copy(this.root.position);
          this.desk.worldToLocal(this.temp);
          this.state.deskOffset = [this.temp.x, this.temp.z];
          saveState(this.state);
        }
      }
    }
  }

  private updateGiveUp(now: number): void {
    const giveUp = this.giveUp;
    if (!giveUp) return;
    const stillHolding =
      giveUp.hand.pinching && giveUp.hand.pinchPoint.distanceTo(this.potCenter) < POT_GRAB_RADIUS * 1.6;
    if (!stillHolding || this.state.phase !== 'growing') {
      this.giveUp = null;
      return;
    }
    if (this.clock - giveUp.start > GIVE_UP_HOLD_S) {
      this.giveUp = null;
      this.wilt(now);
    }
  }

  private updateWatering(delta: number, now: number): void {
    if (this.state.phase !== 'planted' || this.held) {
      this.waterHold = 0;
      this.droplets.visible = false;
      return;
    }
    let pouring: HandState | null = null;
    for (const hand of handList) {
      if (!hand.palmUp) continue;
      const dx = hand.palmCenter.x - this.soilWorld.x;
      const dz = hand.palmCenter.z - this.soilWorld.z;
      const dy = hand.palmCenter.y - this.soilWorld.y;
      if (Math.hypot(dx, dz) < WATER_RADIUS && dy > 0.03 && dy < 0.45) {
        pouring = hand;
        break;
      }
    }
    if (pouring) {
      this.waterHold += delta;
      this.droplets.visible = true;
      this.ripples.active = true;
      this.droplets.animate(this.clock, pouring.palmCenter.y - this.soilWorld.y);
      if (this.waterHold >= WATER_HOLD_S) {
        this.startSession(now);
      }
    } else {
      this.waterHold = Math.max(0, this.waterHold - delta * 2);
      this.droplets.visible = false;
    }
  }

  /** Ray or mouse selection: the fallback for controllers and the desktop preview. */
  private onPressed(entity: Entity): void {
    const target = entity.object3D;
    if (!target) return;
    if (this.immersive) {
      target.getWorldPosition(this.temp2);
      for (const hand of handList) {
        if (hand.tracked && hand.pinchPoint.distanceTo(this.temp2) < NEAR_HAND_RADIUS) {
          return; // A near pinch is already handling this.
        }
      }
    }
    const now = Date.now();
    const role = entity.getValue(TendTarget, 'role');
    const phase = this.state.phase;
    if (role === TargetRole.Seed && phase === 'empty') {
      this.plantSeed();
    } else if (role === TargetRole.Species && phase === 'empty') {
      this.cycleSpecies();
    } else if (role === TargetRole.Duration && (phase === 'empty' || phase === 'planted')) {
      this.cycleDuration();
    } else if (role === TargetRole.Pot) {
      if (phase === 'planted') {
        this.startSession(now);
      } else if (phase === 'growing') {
        this.ringFlashUntil = now + 4000;
        this.plant.push(Math.random() - 0.5, Math.random() - 0.5, 0.8);
        sounds.rustle();
      }
    }
  }

  private dropHeld(): void {
    this.held = null;
    this.giveUp = null;
    this.waterHold = 0;
  }

  // ---------------------------------------------------------------------------
  // Phase transitions

  private cycleDuration(): void {
    if (this.state.starter) {
      // Leaving the starter: begin from the shortest regular length.
      this.state.starter = false;
      this.state.durationMin = DURATION_CHOICES[0];
    } else {
      const i = DURATION_CHOICES.indexOf(this.state.durationMin);
      this.state.durationMin = DURATION_CHOICES[(i + 1) % DURATION_CHOICES.length];
    }
    sounds.select();
    saveState(this.state);
  }

  private cycleSpecies(): void {
    const options = unlockedSpecies(this.state.bestStreak);
    const i = options.findIndex((s) => s.id === this.state.species);
    this.state.species = options[(i + 1) % options.length].id;
    sounds.select();
    saveState(this.state);
  }

  /** Puts a fresh plant of the planted species in the pot. */
  private replacePlant(): void {
    const pot = this.potEntity.object3D!;
    if (this.plant) {
      pot.remove(this.plant);
      disposeTree(this.plant);
    }
    this.plant = new Plant(this.state.completed % 6, this.state.plantedSpecies);
    this.plant.position.y = SOIL_Y;
    pot.add(this.plant);
  }

  private plantSeed(): void {
    this.state.phase = 'planted';
    this.state.plantedSpecies = this.state.species;
    this.replacePlant();
    this.state.learned.plant = true;
    this.held = null;
    sounds.plant();
    saveState(this.state);
  }

  private startSession(now: number): void {
    const s = this.state;
    s.phase = 'growing';
    s.startedAt = now;
    s.durationMs = this.sessionMinutes() * 60_000;
    s.lastSeen = now;
    this.waterHold = 0;
    this.droplets.visible = false;
    this.hintUntil = now + 8000;
    this.resetCues();
    s.learned.water = true;
    sounds.water();
    if (s.spoken) speak(`Focus session started. ${spokenRemaining(s.durationMs)}.`);
    saveState(s);
  }

  private complete(now: number): void {
    const s = this.state;
    s.phase = 'bloomed';
    s.phaseAt = now;
    s.completed += 1;
    s.starter = false;
    s.garden.push({
      hue: (s.completed - 1) % 6,
      finishedAt: now,
      minutes: Math.round(s.durationMs / 60_000),
      species: s.plantedSpecies,
    });
    const today = localDay(now);
    if (s.lastCompleteDay !== today) {
      const yesterday = localDay(now - 86_400_000);
      s.streakDays = s.lastCompleteDay === yesterday ? s.streakDays + 1 : 1;
      s.lastCompleteDay = today;
    }
    const before = s.bestStreak;
    s.bestStreak = Math.max(s.bestStreak, s.streakDays);
    const unlocked = SPECIES.filter((sp) => sp.unlockStreak > before && sp.unlockStreak <= s.bestStreak);
    this.unlockMessage = unlocked.length
      ? `${s.streakDays}-day streak! ${unlocked.map((sp) => sp.name).join(' and ')} unlocked`
      : '';
    if (unlocked.length) s.species = unlocked[unlocked.length - 1].id;
    sounds.bloom();
    this.temp.set(0, SOIL_Y + this.plant.topHeight, 0);
    this.burst.trigger(this.temp, this.plant.tint, 1);
    // A butterfly emerges from the new flower.
    this.spawnButterfly(this.temp);
    if (s.spoken) speak(this.unlockMessage ? `Your plant bloomed. ${this.unlockMessage}.` : 'Your plant bloomed. Well done.');
    this.publishSoon();
    saveState(s);
  }

  private wilt(now: number): void {
    const s = this.state;
    s.phase = 'wilted';
    s.phaseAt = now;
    s.wilted += 1;
    this.giveUp = null;
    sounds.wilt();
    if (s.spoken) speak('Your plant wilted.');
    saveState(s);
  }

  private toEmpty(): void {
    this.state.phase = 'empty';
    this.seed.position.copy(SEED_HOME);
    saveState(this.state);
  }

  private resetCues(): void {
    const s = this.state;
    const now = Date.now();
    this.halfwayPlayed = s.phase === 'growing' && this.progress(now) >= 0.5;
    // Skip the two-minute cue for very short (test) sessions.
    this.twoMinutesPlayed =
      s.durationMs <= 150_000 || (s.phase === 'growing' && s.startedAt + s.durationMs - now <= 120_000);
  }

  private sessionMinutes(): number {
    return this.testMinutes ?? (this.state.starter ? STARTER_MINUTES : this.state.durationMin);
  }

  private applyContrast(on: boolean): void {
    this.state.highContrast = on;
    this.hint.setHighContrast(on);
    this.chip.setHighContrast(on);
    this.speciesChip?.setHighContrast(on);
    for (const label of this.friendLabels) label.setHighContrast(on);
  }

  private weekText(now: number): string {
    const week = weekSummary(this.state, now);
    const streak = week.streak > 1 ? ` · ${week.streak}-day streak` : '';
    return `This week: ${week.sessions} session${week.sessions === 1 ? '' : 's'} · ${formatMinutes(week.minutes)}${streak}`;
  }

  /** Voice alternatives for each gesture. */
  private onVoice(command: VoiceCommand): void {
    const now = Date.now();
    const s = this.state;
    if (command === 'plant' && s.phase === 'empty') {
      this.plantSeed();
    } else if (command === 'water' && s.phase === 'planted') {
      this.startSession(now);
    } else if (command === 'time' && s.phase === 'growing') {
      this.ringFlashUntil = now + 5000;
      speak(spokenRemaining(s.startedAt + s.durationMs - now));
    } else if (command === 'end' && s.phase === 'growing') {
      this.wilt(now);
    } else if (command === 'week') {
      this.summaryUntil = now + 5000;
      speak(this.weekText(now));
    } else if (command === 'help') {
      speak(this.hintText(now, false) || 'Focus. Say time to hear how long is left.');
    }
  }

  private progress(now: number): number {
    const s = this.state;
    return s.durationMs > 0 ? clamp01((now - s.startedAt) / s.durationMs) : 0;
  }

  /** Publishes this garden shortly, so several quick changes send one update. */
  private publishSoon(): void {
    if (!this.sync) return;
    window.clearTimeout(this.publishTimer);
    this.publishTimer = window.setTimeout(() => {
      void publishGarden(this.sync!, this.state, currentStreak(this.state)).catch(() => false);
    }, 1000);
  }

  private followCode(text: string): void {
    const code = normalizeCode(text);
    if (!code || code === this.state.syncCode || this.state.friendCodes.includes(code)) return;
    this.state.friendCodes = [code, ...this.state.friendCodes].slice(0, MAX_LIVE_FRIENDS);
    saveState(this.state);
    void this.refreshFriends();
  }

  /** Fetches followed gardens and replaces their snapshots with the live versions. */
  private async refreshFriends(): Promise<void> {
    if (!this.sync || this.state.friendCodes.length === 0) return;
    let live;
    try {
      live = await fetchGardens(this.sync, this.state.friendCodes);
    } catch {
      return; // Offline or not set up: keep what we have.
    }
    const ordered = this.state.friendCodes.flatMap((code) => live.filter((g) => g.code === code));
    if (import.meta.env.DEV) console.info(`[Tend] friends refreshed: ${live.map((g) => `${g.name}:${g.plants.length}`).join(', ')}`);
    const linkOnly = this.state.friends.filter((f) => !f.code && !ordered.some((g) => g.name === f.name));
    const next = [...ordered, ...linkOnly].slice(0, MAX_LIVE_FRIENDS);
    const same = JSON.stringify(next.map(({ sharedAt: _, ...f }) => f)) ===
      JSON.stringify(this.state.friends.map(({ sharedAt: _, ...f }) => f));
    if (same) return;
    this.state.friends = next;
    saveState(this.state);
    this.rebuildFriends();
  }

  /** Friends' gardens sit on the desk to the right of yours, each with a name label. */
  private rebuildFriends(): void {
    for (const child of [...this.friendsGroup.children]) {
      this.friendsGroup.remove(child);
      disposeTree(child);
    }
    this.friendLabels = [];
    this.friendPlants = [];
    this.state.friends.forEach((friend, f) => {
      const group = new Group();
      group.position.set(0.3 + f * 0.24, 0, -0.04);
      friend.plants.forEach((item, i) => {
        const potted = createPot();
        const plant = new Plant(item.hue, item.species);
        plant.pose(1, 1, 0);
        plant.position.y = SOIL_Y;
        potted.add(plant);
        potted.scale.setScalar(0.4);
        potted.position.set(((i % 4) - 1.5) * 0.05, 0, Math.floor(i / 4) * -0.06);
        group.add(potted);
        this.friendPlants.push(plant);
      });
      const label = new Label(0.17);
      const streak = friend.streak > 1 ? ` · ${friend.streak}-day streak` : '';
      label.setText(`${friend.name}'s garden${streak}`);
      label.setHighContrast(this.state.highContrast);
      label.position.set(0, 0.015, 0.07);
      group.add(label);
      this.friendLabels.push(label);
      this.friendsGroup.add(group);
    });
  }

  private rebuildGarden(): void {
    for (const child of [...this.garden.children]) {
      this.garden.remove(child);
      disposeTree(child);
    }
    this.gardenPlants = [];
    const items = this.state.garden.slice(-GARDEN_MAX);
    items.forEach((item, i) => {
      // Each finished plant sits in its own small pot.
      const potted = createPot();
      const plant = new Plant(item.hue, item.species ?? 'daisy');
      plant.pose(1, 1, 0);
      plant.position.y = SOIL_Y;
      potted.add(plant);
      potted.scale.setScalar(0.5);
      // Spread around the right side and back, leaving the front and the seed's side clear.
      const angle = Math.PI * (0.4 + (0.85 * (i + 0.5)) / GARDEN_MAX);
      const radius = 0.14 + (i % 2) * 0.05;
      potted.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
      this.garden.add(potted);
      this.gardenPlants.push(plant);
    });
  }

  // ---------------------------------------------------------------------------
  // Visuals

  private syncVisuals(now = Date.now()): void {
    const s = this.state;
    const phase = s.phase;
    const hands = this.immersive && anyHandTracked();

    // Seed: floats beside the pot until planted, then sits in the soil.
    this.seed.visible = phase === 'empty' || phase === 'planted';
    this.seedGlow.visible = phase === 'empty';
    if (phase === 'planted') {
      this.seed.position.set(0, SOIL_Y + 0.006, 0);
    } else if (phase === 'empty' && this.held?.kind !== 'seed') {
      this.temp.copy(SEED_HOME);
      this.temp.y += Math.sin(this.clock * 2) * 0.008;
      this.seed.position.lerp(this.temp, 0.15);
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 3);
      this.seedGlow.scale.setScalar(0.9 + pulse * 0.25);
    }

    // Plant.
    this.plant.visible = phase === 'growing' || phase === 'bloomed' || phase === 'wilted';
    if (phase === 'growing') {
      this.plant.pose(this.progress(now), 0, 0);
    } else if (phase === 'bloomed') {
      this.plant.pose(1, clamp01((now - s.phaseAt) / 2500), 0);
      this.plant.visible = now - s.phaseAt < BLOOM_SHOW_MS - 300;
    } else if (phase === 'wilted') {
      this.plant.pose(Math.max(this.progress(s.phaseAt), 0.25), 0, clamp01((now - s.phaseAt) / 2000));
    }

    // Time ring: shown while a palm is up, or briefly after a click.
    let ringTarget = 0;
    if (phase === 'growing') {
      const palmUp = handList.some((h) => h.palmUp);
      if (palmUp || now < this.ringFlashUntil || this.giveUp) ringTarget = 1;
      this.ring.setProgress(this.progress(now));
      this.ring.setWarning(this.giveUp !== null);
    }
    this.ring.setOpacity(this.ring.opacity + (ringTarget - this.ring.opacity) * 0.15);

    // Chip: duration picker before a session, time left during one.
    if (phase === 'empty' || phase === 'planted') {
      const minutes = this.sessionMinutes();
      this.chip.setText(s.starter && this.testMinutes == null ? `${minutes} min starter` : `${minutes} min`);
      this.chip.material.opacity = 1;
    } else if (phase === 'growing' && this.ring.opacity > 0.05) {
      this.chip.setText(formatRemaining(s.startedAt + s.durationMs - now));
      this.chip.material.opacity = this.ring.opacity;
    } else {
      this.chip.setText('');
    }

    // Species chip: shown before planting once there is more than one to choose from.
    const options = unlockedSpecies(s.bestStreak);
    if (!options.some((o) => o.id === s.species)) s.species = options[0].id; // a season ended
    if (phase === 'empty' && options.length > 1) {
      const chosen = speciesById(s.species);
      this.speciesChip.setText(chosen.season ? `${chosen.name} · ${chosen.season}` : chosen.name);
    } else {
      this.speciesChip.setText('');
    }
    this.seedBody.material.color.set(speciesById(phase === 'empty' ? s.species : s.plantedSpecies).seedColor);

    this.hint.setText(this.hintText(now, hands));

    this.chip.lookAt(this.camera.getWorldPosition(this.temp2));
    this.hint.lookAt(this.temp2);
    this.speciesChip.lookAt(this.temp2);
    for (const label of this.friendLabels) label.lookAt(this.temp2);
  }

  private hintText(now: number, hands: boolean): string {
    const s = this.state;
    if (this.immersive && !this.placed) return 'Looking for your desk...';
    switch (s.phase) {
      case 'empty':
        if (now < this.summaryUntil) return this.weekText(now);
        if (this.held?.kind === 'seed') return 'Drop it into the pot';
        if (this.held?.kind === 'pot') return 'Let go to set the pot down';
        if (s.garden.length > 0 && s.learned.plant) {
          const days = currentStreak(s, now);
          const streak = days > 1 ? ` · ${days}-day streak` : '';
          const next = nextUnlock(s.bestStreak);
          const seasonal = seasonalSpecies();
          const grownThisSeason =
            seasonal && s.garden.some((p) => p.species === seasonal.id && now - p.finishedAt < 92 * 86_400_000);
          const goal =
            seasonal && !grownThisSeason
              ? ` · ${seasonal.name} is in season`
              : next
                ? ` · ${next.name} at ${next.unlockStreak} days`
                : '';
          return `Plant today's seed${streak}${goal}`;
        }
        return hands ? 'Pinch the seed and drop it in the pot' : 'Select the seed to plant it';
      case 'planted':
        if (this.waterHold > 0) return 'Watering...';
        return hands ? 'Hold your open palm over the pot to water it' : 'Select the pot to water it';
      case 'growing':
        if (this.giveUp) return 'Keep pinching to end the session early';
        if (now < this.resumedUntil) return 'Welcome back. Your plant waited for you';
        if (now < this.hintUntil) {
          return hands ? 'Focus. Turn a palm up to see the time' : 'Focus. Select the pot to see the time';
        }
        return '';
      case 'bloomed': {
        if (this.unlockMessage && now - s.phaseAt > 3000) return this.unlockMessage;
        const count = s.garden.length;
        const streak = s.streakDays > 1 ? ` · ${s.streakDays}-day streak` : '';
        return `It bloomed! ${count} plant${count === 1 ? '' : 's'} in your garden${streak}`;
      }
      case 'wilted':
        return 'Session ended early. It wilted';
    }
  }
}

function disposeTree(object: Object3D): void {
  object.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      const material = o.material as { map?: { dispose(): void } | null; dispose(): void };
      material.map?.dispose();
      material.dispose();
    }
  });
}

function spokenRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'} left`;
  }
  return `${seconds} seconds left`;
}

function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min left`;
  return `${seconds}s left`;
}

function distanceToSegment(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? clamp01(((x - a.x) * dx + (z - a.z) * dz) / lengthSq) : 0;
  return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
}
