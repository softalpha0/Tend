import { createSystem, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

/**
 * Per-frame hand tracking summary used by Tend's gestures. Read joint poses
 * straight from the XR frame so we can detect pinch and palm-up without a
 * controller.
 */
export interface HandState {
  tracked: boolean;
  pinching: boolean;
  /** Pinch started this frame. */
  pinchStart: boolean;
  /** Pinch ended this frame (including when tracking is lost mid-pinch). */
  pinchEnd: boolean;
  /** Midpoint between thumb tip and index tip, in world space. */
  pinchPoint: Vector3;
  /** Centre of the palm, in world space. */
  palmCenter: Vector3;
  /** Unit vector pointing out of the palm side of the hand, in world space. */
  palmNormal: Vector3;
  /** Palm is facing roughly upward and the hand is open. */
  palmUp: boolean;
}

function makeHand(): HandState {
  return {
    tracked: false,
    pinching: false,
    pinchStart: false,
    pinchEnd: false,
    pinchPoint: new Vector3(),
    palmCenter: new Vector3(),
    palmNormal: new Vector3(0, -1, 0),
    palmUp: false,
  };
}

export const hands: Record<'left' | 'right', HandState> = {
  left: makeHand(),
  right: makeHand(),
};
export const handList: HandState[] = [hands.left, hands.right];

// Distances in metres between thumb tip and index tip.
const PINCH_START = 0.022;
const PINCH_END = 0.04;
// How far up the palm normal must point (cosine of the angle from vertical).
const PALM_UP_ON = 0.6;
const PALM_UP_OFF = 0.45;
// Thumb and index far apart means an open hand, not a loose pinch.
const OPEN_HAND = 0.05;

export class HandGestureSystem extends createSystem({}) {
  private thumb = new Vector3();
  private index = new Vector3();
  private matrix = new Matrix4();
  private rotation = new Quaternion();
  private originRotation = new Quaternion();
  private seen = { left: false, right: false };

  update(): void {
    this.seen.left = false;
    this.seen.right = false;
    for (const hand of handList) {
      hand.pinchStart = false;
      hand.pinchEnd = false;
    }

    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    const session = this.world.session;
    if (frame && space && session) {
      const origin = this.world.player;
      origin.updateMatrixWorld();
      origin.getWorldQuaternion(this.originRotation);
      for (const source of session.inputSources) {
        const xrHand = source.hand;
        if (!xrHand || (source.handedness !== 'left' && source.handedness !== 'right')) {
          continue;
        }
        const state = hands[source.handedness];
        const thumbPose = frame.getJointPose?.(xrHand.get('thumb-tip')!, space);
        const indexPose = frame.getJointPose?.(xrHand.get('index-finger-tip')!, space);
        const palmPose = frame.getJointPose?.(xrHand.get('middle-finger-metacarpal')!, space);
        if (!thumbPose || !indexPose || !palmPose) {
          continue;
        }
        this.seen[source.handedness] = true;
        state.tracked = true;

        const tp = thumbPose.transform.position;
        const ip = indexPose.transform.position;
        this.thumb.set(tp.x, tp.y, tp.z).applyMatrix4(origin.matrixWorld);
        this.index.set(ip.x, ip.y, ip.z).applyMatrix4(origin.matrixWorld);
        state.pinchPoint.copy(this.thumb).add(this.index).multiplyScalar(0.5);

        const pp = palmPose.transform.position;
        state.palmCenter.set(pp.x, pp.y, pp.z).applyMatrix4(origin.matrixWorld);
        // WebXR joint space: -Y points out of the palm side of the hand.
        this.matrix.fromArray(palmPose.transform.matrix);
        this.rotation.setFromRotationMatrix(this.matrix).premultiply(this.originRotation);
        state.palmNormal.set(0, -1, 0).applyQuaternion(this.rotation);

        const gap = this.thumb.distanceTo(this.index);
        if (!state.pinching && gap < PINCH_START) {
          state.pinching = true;
          state.pinchStart = true;
        } else if (state.pinching && gap > PINCH_END) {
          state.pinching = false;
          state.pinchEnd = true;
        }

        const up = state.palmNormal.y;
        const open = gap > OPEN_HAND;
        const wasUp = state.palmUp;
        state.palmUp = state.palmUp ? up > PALM_UP_OFF && !state.pinching : up > PALM_UP_ON && open;
        if (import.meta.env.DEV) {
          if (state.pinchStart || state.pinchEnd || wasUp !== state.palmUp) {
            console.info(
              `[Tend] ${source.handedness} pinch=${state.pinching} palmUp=${state.palmUp} gap=${gap.toFixed(3)} ` +
                `palmY=${up.toFixed(2)} at ${state.pinchPoint.toArray().map((v) => v.toFixed(2)).join(',')}`,
            );
          }
        }
      }
    }

    // Hands that disappeared this frame end any pinch they were holding.
    for (const side of ['left', 'right'] as const) {
      if (!this.seen[side]) {
        const state = hands[side];
        if (state.pinching) {
          state.pinching = false;
          state.pinchEnd = true;
        }
        state.tracked = false;
        state.palmUp = false;
      }
    }
  }
}

export function anyHandTracked(): boolean {
  return hands.left.tracked || hands.right.tracked;
}
