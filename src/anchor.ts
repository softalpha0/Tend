import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

/**
 * Pins the pot to the real world with a WebXR spatial anchor and keeps the
 * anchor across sessions with a persistent handle, so the pot and its garden
 * come back to exactly where the user left them.
 *
 * Persistent anchors are a Meta Quest Browser extension, so every call is
 * guarded; without support the pot falls back to desk detection.
 */

type PersistentSession = XRSession & {
  restorePersistentAnchor?(uuid: string): Promise<XRAnchor>;
  deletePersistentAnchor?(uuid: string): Promise<void>;
};
type PersistentAnchor = XRAnchor & { requestPersistentHandle?(): Promise<string> };
type AnchorFrame = XRFrame & {
  createAnchor?(pose: XRRigidTransform, space: XRSpace): Promise<XRAnchor> | undefined;
};

const STORAGE_KEY = 'tend.potAnchor.v1';

export class PotAnchor {
  private anchor: XRAnchor | null = null;
  private session: PersistentSession | null = null;
  private saving = false;
  private matrix = new Matrix4();
  private position = new Vector3();
  private quaternion = new Quaternion();
  private scale = new Vector3();

  /** Tries to restore the anchor saved in an earlier session. */
  async restore(session: XRSession | undefined): Promise<boolean> {
    this.session = (session as PersistentSession) ?? null;
    const uuid = readKey();
    if (!this.session?.restorePersistentAnchor || !uuid) return false;
    try {
      this.anchor = await this.session.restorePersistentAnchor(uuid);
      return true;
    } catch {
      // The anchor was cleared from the headset, or the space changed.
      writeKey(null);
      return false;
    }
  }

  /** Drops the current anchor so nothing pulls the pot while the user moves it. */
  release(): void {
    this.anchor = null;
  }

  /**
   * Replaces the saved anchor with a new one at the given reference-space pose.
   * Must be called during an XR frame.
   */
  save(frame: XRFrame, space: XRReferenceSpace, position: Vector3, quaternion: Quaternion): void {
    const anchorFrame = frame as AnchorFrame;
    if (this.saving || typeof anchorFrame.createAnchor !== 'function') return;
    const previous = this.anchor;
    const previousUuid = readKey();
    this.anchor = null;
    this.saving = true;
    let request: Promise<XRAnchor> | undefined;
    try {
      request = anchorFrame.createAnchor(
        new XRRigidTransform(
          { x: position.x, y: position.y, z: position.z },
          { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
        ),
        space,
      );
    } catch {
      request = undefined;
    }
    if (!request) {
      this.saving = false;
      return;
    }
    request
      .then(async (anchor) => {
        this.anchor = anchor;
        previous?.delete();
        if (previousUuid && this.session?.deletePersistentAnchor) {
          await this.session.deletePersistentAnchor(previousUuid).catch(() => undefined);
        }
        writeKey(null);
        const handle = await (anchor as PersistentAnchor).requestPersistentHandle?.().catch(() => undefined);
        if (handle) writeKey(handle);
      })
      .catch(() => undefined)
      .finally(() => {
        this.saving = false;
      });
  }

  /** Reads the anchor's current pose into `position` and `quaternion`, if tracked. */
  read(frame: XRFrame, space: XRReferenceSpace, position: Vector3, quaternion: Quaternion): boolean {
    if (!this.anchor) return false;
    let pose: XRPose | undefined;
    try {
      pose = frame.getPose(this.anchor.anchorSpace, space);
    } catch {
      return false;
    }
    if (!pose) return false;
    this.matrix.fromArray(pose.transform.matrix);
    this.matrix.decompose(this.position, this.quaternion, this.scale);
    position.copy(this.position);
    quaternion.copy(this.quaternion);
    return true;
  }

  get active(): boolean {
    return this.anchor !== null;
  }

  /** Anchors belong to one XR session; forget them when it ends. */
  endSession(): void {
    this.anchor = null;
    this.session = null;
    this.saving = false;
  }
}

function readKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeKey(value: string | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the anchor lasts for this session only.
  }
}
