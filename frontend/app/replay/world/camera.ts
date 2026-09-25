/**
 * One unbroken camera flight. Each beat has a pose that may move on its own (a low sweep, an
 * orbit, a slow push-in); moving between beats flies along a curved path while a second path
 * steers the gaze, so the camera leads into its turns. It never cuts and never freezes: at a beat
 * it slows into a drift and keeps breathing.
 */

import { CatmullRomCurve3, type PerspectiveCamera, Vector3 } from "three";
import { clamp01, easeInOut } from "../../sky/geometry";

export type Pose = { position: Vector3; target: Vector3 };

type Flight = {
  path: CatmullRomCurve3;
  gaze: CatmullRomCurve3;
  started: number;
  duration: number;
};

export class CameraRig {
  readonly position = new Vector3(0, 2.6, 15.6);
  readonly target = new Vector3(0, 2.6, 0);
  private flight: Flight | null = null;
  private readonly reducedMotion: boolean;
  private shake = 0;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** Start a flight from where the camera is now to wherever `pose` will be. */
  flyTo(pose: Pose, now: number) {
    const start = this.position.clone();
    const end = pose.position.clone();
    const distance = start.distanceTo(end);
    // A crane move: rise and ease back a little through the middle of the flight.
    const lift = Math.min(14, 1.2 + distance * 0.16);
    const back = Math.min(12, distance * 0.08);
    const via = (t: number) => start.clone().lerp(end, t).add(new Vector3(0, lift * Math.sin(Math.PI * t), back * Math.sin(Math.PI * t)));
    const path = new CatmullRomCurve3([start, via(0.33), via(0.66), end], false, "centripetal");
    const gazeStart = this.target.clone();
    const gazeEnd = pose.target.clone();
    const gaze = new CatmullRomCurve3([gazeStart, gazeStart.clone().lerp(gazeEnd, 0.5).add(new Vector3(0, lift * 0.35, 0)), gazeEnd], false, "centripetal");
    this.flight = {
      path,
      gaze,
      started: now,
      duration: this.reducedMotion ? 700 : Math.min(5600, 2300 + distance * 38),
    };
  }

  /** A short tremor for impacts; ignored when motion is reduced. */
  kick(strength: number) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, strength);
  }

  /** Move the camera toward this frame's pose and aim it. `pose` is where the beat wants it. */
  update(camera: PerspectiveCamera, pose: Pose, now: number) {
    if (this.flight) {
      const progress = clamp01((now - this.flight.started) / this.flight.duration);
      const eased = easeInOut(progress);
      // The beat's pose keeps moving during the flight; the path's end follows it.
      this.flight.path.points[this.flight.path.points.length - 1].copy(pose.position);
      this.flight.gaze.points[this.flight.gaze.points.length - 1].copy(pose.target);
      this.flight.path.getPoint(eased, this.position);
      // The gaze leads: it turns a little ahead of the body.
      this.flight.gaze.getPoint(Math.min(1, easeInOut(Math.min(1, progress * 1.15))), this.target);
      if (progress >= 1) this.flight = null;
    } else {
      const follow = this.reducedMotion ? 1 : 0.06;
      this.position.lerp(pose.position, follow);
      this.target.lerp(pose.target, follow);
    }

    camera.position.copy(this.position);
    if (!this.reducedMotion) {
      // Breathing: the camera is never perfectly still.
      const t = now / 1000;
      camera.position.x += Math.sin(t * 0.31) * 0.09 + Math.sin(t * 0.73) * 0.03;
      camera.position.y += Math.sin(t * 0.23) * 0.06;
      if (this.shake > 0.001) {
        camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
        camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
        this.shake *= 0.9;
      }
    }
    camera.lookAt(this.target);
  }
}
