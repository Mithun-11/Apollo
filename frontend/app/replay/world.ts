/**
 * The replay's 3D world: an evening lake with hills, poles and layered clouds, the recording's
 * spectrogram standing as the sky and then laid down as a mountain range of sound, its peaks as
 * stars on the summits, the catalog as a galaxy above the clouds, and one camera that flies
 * through all of it without cutting. Every data object is built from measured values.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import { MAX_FREQUENCY_HZ, MIN_FREQUENCY_HZ, clamp01, easeInOut, easeOut } from "../sky/geometry";
import type { ReplayData } from "./data";
import { CameraRig, type Pose } from "./world/camera";
import { Lake, REFLECTED_LAYER, reflect } from "./world/lake";
import { SUN_DIRECTION, Scenery } from "./world/scenery";
import {
  COLORS,
  FIELD_BASE,
  FIELD_DEPTH,
  FIELD_WIDTH,
  type SharedUniforms,
  StarField,
  Strokes,
  TERRAIN_HEIGHT,
  hash,
  sharedUniforms,
  starSprite,
} from "./world/shared";
import type { Cue } from "./world/audio";
import { Curtain, GlowVolume, Meteors, Shatter } from "./world/effects";
import { Rain } from "./world/rain";
import { Post, type PostFrame } from "./world/post";
import { SoundField } from "./world/terrain";

export type ChapterId =
  | "sound"
  | "spectrum"
  | "stars"
  | "fingerprint"
  | "catalog"
  | "musubi"
  | "warp"
  | "voice"
  | "listen"
  | "verdict";

export type WorldLabel = {
  id: string;
  text: string;
  detail?: string;
  tone: "star" | "comet" | "thread" | "lantern";
  x: number;
  y: number;
  visible: boolean;
};

const MAX_THREADS = 140;
const STAR_LIFT = 0.14;
/** The galaxy of catalog songs hangs above the clouds. */
const GALAXY_CENTER = new Vector3(0, 92, -130);

/** The moment, in seconds into the Alignment beat, when the song's stars lock onto the recording's. */
const LOCK_AT = 6.4;
const DEBRIS_PER_PILLAR = 26;

/** Where the wide opening shot stands: it frames the standing sky exactly as the live sky. */
const WIDE: Pose = { position: new Vector3(0, 2.6, 15.6), target: new Vector3(0, 2.6, 0) };

/** A point in the laid-down field's frame, expressed in the world (tilt = 1). */
function laid(local: Vector3): Vector3 {
  return new Vector3(local.x, FIELD_BASE + local.z, -local.y);
}

/** An arc between two points of the field, rising along its loudness axis (local z). */
function arc(out: number[], from: Vector3, to: Vector3, height: number, steps = 8) {
  let px = from.x;
  let py = from.y;
  let pz = from.z;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t + Math.sin(Math.PI * t) * height;
    out.push(px, py, pz, x, y, z);
    px = x;
    py = y;
    pz = z;
  }
}

export class ReplayWorld {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(42, 16 / 9, 0.1, 1200);
  private readonly shared: SharedUniforms = sharedUniforms();
  private readonly sprite = starSprite();
  private readonly data: ReplayData;
  private readonly reducedMotion: boolean;
  private readonly highlight: boolean;
  private readonly rig: CameraRig;
  private readonly scenery: Scenery;
  private readonly lake: Lake;
  private readonly field: SoundField;

  private chapter: ChapterId = "sound";
  private chapterStarted = 0;
  private noise = false;
  private noiseLevel = 0;
  private listenStarted: number | null = null;
  private tilt = 0;
  private sceneSeen = false;
  private pairFocus = new Vector3();

  // The recording
  private readonly stars: StarField;
  private readonly starTimes: number[];
  private readonly waveform: Mesh;
  private readonly waveformMaterial: MeshBasicMaterial;
  private readonly shatter: Shatter;
  private readonly shatterEnd: number;
  // Fingerprints
  private readonly zoneVolume = new GlowVolume(COLORS.lantern);
  private readonly pulse: StarField;
  private readonly pairStrokes = new Strokes(COLORS.lantern, 3.4, 1, 16);
  private readonly zoneStrokes = new Strokes(COLORS.lantern, 2.2, 0.9, 24);
  private readonly webStrokes = new Strokes(COLORS.lantern, 1.2, 0.22, 1800);
  // Catalog
  private readonly galaxy = new Group();
  private readonly clusterField: StarField;
  private readonly clusters: { songId: string; name: string; center: Vector3; hits: number; seeds: number[] }[] = [];
  private readonly meteors: Meteors;
  // Song and alignment
  private readonly songGroup = new Group();
  private readonly songStars: StarField;
  private readonly threads = new Strokes(COLORS.thread, 3.2, 1, MAX_THREADS * 8 + 16);
  private readonly knots: StarField;
  private readonly threadPairs: { query: Vector3; song: Vector3 }[] = [];
  private readonly pillars = new Group();
  private readonly pillarMeshes: { mesh: Mesh; height: number; winning: boolean }[] = [];
  // The lock: debris from the false pillars, the shockwave, and the film effects of the impact.
  private readonly debris: StarField;
  private readonly debrisVelocity: Float32Array;
  private readonly debrisHome: { x: number; z: number; height: number }[] = [];
  private debrisStarted = -1;
  private lockKicked = false;
  private lockPlayed = false;
  private readonly onLock: (() => void) | undefined;
  private readonly onCue: ((cue: Cue) => void) | undefined;
  /** Cues already played in this beat, so each fires once per visit. */
  private readonly fired = new Set<string>();
  // The noise storm.
  private readonly rain = new Rain(3500, -30, 30, -26, 12, 20, new Color("#b9c9ec"));
  private nextBolt = 0;
  private boltAt = -10;
  private shock: { x: number; z: number; radius: number; strength: number } | null = null;
  private readonly post: Post | null = null;
  private postBlend = 0;
  private readonly fx: PostFrame = { bloom: 1, focus: null, flash: 0, chroma: 0 };
  private lastFrame = 0;
  // Edits and covers
  private readonly curveStrokes = new Strokes(COLORS.comet, 2.6, 1, 96);
  private readonly curveCursor = new Strokes(COLORS.lantern, 2, 1, 4);
  private readonly curveCurtain = new Curtain(COLORS.comet, 128);
  private readonly queryCurtain = new Curtain(COLORS.lantern, 700);
  private readonly songCurtain = new Curtain(COLORS.comet, 1300);
  private readonly voiceGroup = new Group();
  private mixPlane: Mesh | null = null;
  private vocalPlane: Mesh | null = null;
  private readonly contourQuery = new Strokes(COLORS.lantern, 5, 1, 600);
  private readonly contourSong = new Strokes(COLORS.comet, 5, 1, 1200);
  private readonly dtwThreads = new Strokes(COLORS.thread, 1.6, 0.8, 300);

  constructor(
    canvas: HTMLCanvasElement,
    data: ReplayData,
    options: { reducedMotion: boolean; highlight: boolean; onLock?: () => void; onCue?: (cue: Cue) => void },
  ) {
    this.data = data;
    this.onLock = options.onLock;
    this.onCue = options.onCue;
    this.reducedMotion = options.reducedMotion;
    this.highlight = options.highlight;
    this.rig = new CameraRig(options.reducedMotion);
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = NoToneMapping;
    this.camera.layers.enable(REFLECTED_LAYER);
    this.camera.position.copy(WIDE.position);
    this.camera.lookAt(WIDE.target);

    // --- The evening: sky dome, land, poles, clouds and the lake.
    this.scenery = new Scenery(this.shared);
    this.scene.add(this.scenery.group);
    this.scenery.group.children.forEach((child) => {
      if (child !== this.scenery.cloudGroup) reflect(child);
    });
    this.lake = new Lake(this.shared, canvas.clientWidth || 1280, canvas.clientHeight || 720);
    this.scene.add(this.lake.mesh);

    // --- The recording's sound field: the sky that becomes a mountain range.
    this.field = new SoundField(this.shared, data.columnLevels, data.duration);
    this.scene.add(this.field.group);

    // Stars: every peak the server kept, standing on the summit under it.
    const peaks = data.response.explanation.peaks;
    const loudest = Math.max(...peaks.map((peak) => peak.amplitudeDb), -1);
    const quietest = Math.min(...peaks.map((peak) => peak.amplitudeDb), loudest - 1);
    this.stars = new StarField(peaks.length, this.sprite, 200);
    this.starTimes = peaks.map((peak) => peak.timeSeconds);
    peaks.forEach((peak, index) => {
      const level = (peak.amplitudeDb - quietest) / Math.max(1, loudest - quietest);
      this.stars.set(
        index,
        [this.field.x(peak.timeSeconds), this.field.y(peak.frequencyHz), STAR_LIFT],
        0.9 + level * 1.5,
        COLORS.star,
        0,
        this.field.level(peak.timeSeconds, peak.frequencyHz),
      );
    });
    this.field.group.add(this.stars.object);
    reflect(this.stars.object);

    // The waveform: a ribbon of real samples standing in the sky, curving in depth.
    const envelope = data.response.explanation.waveformEnvelope;
    const ribbon = new BufferGeometry();
    const vertices = new Float32Array(Math.max(1, envelope.length) * 6);
    envelope.forEach((point, index) => {
      const x = this.field.x(point.timeSeconds);
      const z = Math.sin(x * 0.45) * 0.7;
      vertices.set([x, point.maximum * 1.8, z, x, point.minimum * 1.8, z], index * 6);
    });
    const indices: number[] = [];
    for (let index = 0; index < envelope.length - 1; index += 1) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    ribbon.setAttribute("position", new BufferAttribute(vertices, 3));
    ribbon.setIndex(indices);
    this.waveformMaterial = new MeshBasicMaterial({
      color: COLORS.star,
      transparent: true,
      opacity: 0,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.waveform = new Mesh(ribbon, this.waveformMaterial);
    this.scene.add(this.waveform);

    // The shatter: sparks leave the wave and land in the sky at their own moment, just as the
    // analysis beam reaches it (class mode), or all at once when the highlight opens.
    const paintStart = this.highlight ? 0.1 : 0.8;
    const paintFor = this.highlight ? 1.2 : 5;
    this.shatterEnd = paintStart + paintFor + 1;
    const sparks: { from: Vector3; to: Vector3; launch: number }[] = [];
    const levels = data.columnLevels;
    const rows = levels[0]?.length ?? 0;
    if (envelope.length > 1 && rows > 0) {
      for (let index = 0; index < 2600; index += 1) {
        const point = envelope[Math.floor(hash(index * 1.31) * envelope.length)];
        const x = this.field.x(point.timeSeconds);
        const amplitude = point.minimum + (point.maximum - point.minimum) * hash(index * 2.77);
        const from = new Vector3(x, FIELD_BASE + FIELD_DEPTH * 0.3 + amplitude * 1.8, 1.2 + Math.sin(x * 0.45) * 0.7);
        // Land where this moment is loudest: the best of a few sampled pitches.
        const column = levels[Math.min(levels.length - 1, Math.floor((point.timeSeconds / Math.max(data.duration, 0.001)) * levels.length))];
        let best = 0;
        for (let pick = 0; pick < 6; pick += 1) {
          const row = Math.floor(hash(index * 7.1 + pick * 3.3) * rows);
          if (column[row] > column[best]) best = row;
        }
        const to = new Vector3(x, FIELD_BASE + (1 - best / Math.max(1, rows - 1)) * FIELD_DEPTH, 0.02);
        const fraction = point.timeSeconds / Math.max(data.duration, 0.001);
        sparks.push({ from, to, launch: paintStart + fraction * paintFor - 0.5 });
      }
    }
    this.shatter = new Shatter(sparks, this.sprite, COLORS.star);
    this.scene.add(this.shatter.object);

    // Fingerprint strokes live on the field, so they tilt with it.
    this.pulse = new StarField(1, this.sprite, 260);
    this.pulse.set(0, [0, 0, 0], 2.6, COLORS.lantern, 0);
    this.field.group.add(this.pairStrokes.object, this.zoneStrokes.object, this.webStrokes.object, this.zoneVolume.object, this.pulse.object);

    // --- The catalog: one constellation per song, high above the clouds.
    const songs = data.evidence?.songs ?? [];
    const winnerId = data.response.recognition.song?.id;
    const maxPrints = Math.max(1, ...songs.map((song) => song.fingerprints));
    const clusterPoints = songs.map((song) => Math.round(40 + 110 * Math.log10(1 + song.fingerprints) / Math.log10(1 + maxPrints)));
    this.clusterField = new StarField(clusterPoints.reduce((sum, value) => sum + value, 0), this.sprite, 900);
    let cursor = 0;
    songs.forEach((song, index) => {
      const angle = index * 2.39996 + 0.6;
      const radius = 22 + index * 2.6;
      const center = new Vector3(
        GALAXY_CENTER.x + Math.cos(angle) * radius * 1.7,
        GALAXY_CENTER.y + Math.sin(index * 1.7) * 12,
        GALAXY_CENTER.z + Math.sin(angle) * radius,
      );
      const seeds: number[] = [];
      for (let point = 0; point < clusterPoints[index]; point += 1) {
        const offset = new Vector3((hash(cursor * 3.1) - 0.5) * 12, (hash(cursor * 5.7) - 0.5) * 6, (hash(cursor * 9.3) - 0.5) * 12);
        this.clusterField.set(cursor, center.clone().add(offset), 0.9 + hash(cursor) * 1.5, song.songId === winnerId ? COLORS.comet : COLORS.star, 0);
        seeds.push(cursor);
        cursor += 1;
      }
      this.clusters.push({ songId: song.songId, name: song.name, center, hits: song.hashHits, seeds });
    });
    this.galaxy.add(this.clusterField.object);
    this.scene.add(this.galaxy);

    // Lookups: a meteor storm, one streak per sampled hit, from the recording's stars to a song.
    const totalHits = songs.reduce((sum, song) => sum + song.hashHits, 0);
    const budget = Math.min(1600, totalHits);
    const streakPaths: { from: Vector3; to: Vector3; delay: number }[] = [];
    let streak = 0;
    for (const cluster of this.clusters) {
      const share = totalHits > 0 ? Math.round((cluster.hits / totalHits) * budget) : 0;
      for (let item = 0; item < share && streak < budget; item += 1) {
        const star = Math.floor(hash(streak * 7.7) * this.stars.count);
        const origin = this.stars.count > 0
          ? laid(new Vector3(this.stars.x(star), this.stars.y(star), STAR_LIFT + this.stars.lift(star) * TERRAIN_HEIGHT))
          : new Vector3();
        streakPaths.push({ from: origin, to: cluster.center, delay: hash(streak * 3.3) * 4.5 });
        streak += 1;
      }
    }
    this.meteors = new Meteors(streakPaths, COLORS.lantern);
    this.scene.add(this.meteors.object);

    // --- The song's own stars, which descend and slide onto the recording's.
    const songPeaks = data.songStars;
    this.songStars = new StarField(songPeaks.length, this.sprite, 200);
    songPeaks.forEach((peak, index) => {
      const level = clamp01((peak.amplitudeDb + 60) / 60);
      const hz = peak.frequencyHz * data.pitchFactor;
      this.songStars.set(
        index,
        [this.field.x(peak.timeSeconds), this.field.y(hz), STAR_LIFT + 0.05],
        0.8 + level * 1.3,
        COLORS.comet,
        0,
        this.field.level(peak.timeSeconds, hz),
      );
    });
    this.songGroup.add(this.songStars.object);
    this.field.group.add(this.songGroup);
    reflect(this.songStars.object);

    // Threads: each matched fingerprint ties a recording star to its twin in the song.
    const songStart = data.evidence?.songSky?.startSeconds ?? data.response.recognition.timestampSeconds ?? 0;
    const matched = data.response.explanation.matchedFingerprints;
    const step = Math.max(1, Math.ceil(matched.length / MAX_THREADS));
    for (let index = 0; index < matched.length; index += step) {
      const fingerprint = matched[index];
      const queryTime = fingerprint.queryAnchorSeconds;
      const songTime = (fingerprint.sourceAnchorSeconds - songStart) / Math.max(data.speedFactor, 0.01);
      const level = this.field.level(queryTime, fingerprint.anchorFrequencyHz);
      this.threadPairs.push({
        query: new Vector3(this.field.x(queryTime), this.field.y(fingerprint.anchorFrequencyHz), STAR_LIFT + level * TERRAIN_HEIGHT),
        song: new Vector3(this.field.x(songTime), this.field.y(fingerprint.anchorFrequencyHz), STAR_LIFT + level * TERRAIN_HEIGHT),
      });
    }
    this.knots = new StarField(this.threadPairs.length, this.sprite, 200);
    this.threadPairs.forEach((pair, index) => this.knots.set(index, pair.query, 2.2, COLORS.thread, 0));
    this.field.group.add(this.threads.object, this.knots.object);
    reflect(this.threads.object);
    reflect(this.knots.object);

    // Offset votes: pillars of light standing in the lake in front of the mountains.
    const votes = [...data.response.explanation.decision.clusteredOffsetVotes].sort((a, b) => b.count - a.count).slice(0, 48);
    if (votes.length > 0) {
      const leading = Math.max(...votes.map((vote) => vote.count));
      const first = Math.min(...votes.map((vote) => vote.offsetSeconds));
      const last = Math.max(...votes.map((vote) => vote.offsetSeconds));
      for (const vote of votes) {
        const height = Math.max(0.06, (vote.count / leading) * 5);
        const material = new ShaderMaterial({
          uniforms: { uColor: { value: vote.winning ? COLORS.thread : COLORS.star }, uOpacity: { value: 0 } },
          vertexShader: "varying float vH; void main(){ vH = position.y + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
          fragmentShader: "uniform vec3 uColor; uniform float uOpacity; varying float vH; void main(){ gl_FragColor = vec4(uColor, uOpacity * (1.0 - vH * 0.85));\n#include <colorspace_fragment>\n}",
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
        });
        const mesh = new Mesh(new BoxGeometry(vote.winning ? 0.16 : 0.05, 1, vote.winning ? 0.16 : 0.05), material);
        const position = last > first ? (vote.offsetSeconds - first) / (last - first) : 0.5;
        // Behind the mountains, so they rise above the ridges and double in the water.
        mesh.position.set(-FIELD_WIDTH * 0.42 + position * FIELD_WIDTH * 0.84, 0, -FIELD_DEPTH - 1.2);
        mesh.scale.y = 0.001;
        this.pillars.add(mesh);
        this.pillarMeshes.push({ mesh, height, winning: vote.winning });
      }
    }
    this.scene.add(this.pillars);
    reflect(this.pillars);

    // Debris: each false pillar breaks into sparks that fall into the lake at the lock.
    const falsePillars = this.pillarMeshes.filter((pillar) => !pillar.winning);
    this.debris = new StarField(falsePillars.length * DEBRIS_PER_PILLAR, this.sprite, 200);
    this.debrisVelocity = new Float32Array(Math.max(1, this.debris.count * 3));
    falsePillars.forEach((pillar) => {
      for (let piece = 0; piece < DEBRIS_PER_PILLAR; piece += 1) {
        this.debrisHome.push({ x: pillar.mesh.position.x, z: pillar.mesh.position.z, height: pillar.height });
      }
    });
    this.scene.add(this.debris.object);
    reflect(this.debris.object);
    this.scene.add(this.rain.object);

    // Edits: the speed/pitch search curve stands in the lake.
    this.scene.add(this.curveStrokes.object, this.curveCursor.object, this.curveCurtain.object);
    reflect(this.curveCurtain.object);
    reflect(this.curveStrokes.object);

    // Covers: the separated voice and the two melody lines, standing before the mountains.
    const melody = data.evidence?.melody;
    if (melody) {
      const mix = this.imagePlane(melody.mixSpectrogram, [150, 165, 220]);
      const vocal = this.imagePlane(melody.vocalSpectrogram, [255, 205, 150]);
      mix.position.set(0, FIELD_BASE + FIELD_DEPTH * 0.35, 0.8);
      vocal.position.set(0, FIELD_BASE + FIELD_DEPTH * 0.35, 1.0);
      this.voiceGroup.add(mix, vocal);
      this.mixPlane = mix;
      this.vocalPlane = vocal;
    }
    this.voiceGroup.add(this.contourQuery.object, this.contourSong.object, this.dtwThreads.object, this.queryCurtain.object, this.songCurtain.object);
    this.scene.add(this.voiceGroup);

    try {
      this.post = new Post(this.renderer, this.scene, this.camera, this.reducedMotion);
    } catch {
      this.post = null; // Without post-processing the world still renders, just without glow.
    }
    this.resize();
    // Compile every shader now, during "Preparing the replay…", so the first frames never stall.
    this.renderer.compile(this.scene, this.camera);
  }

  private imagePlane(values: number[][], tint: [number, number, number]): Mesh {
    const rows = values.length;
    const columns = rows > 0 ? values[0].length : 1;
    const canvas = document.createElement("canvas");
    canvas.width = columns;
    canvas.height = Math.max(1, rows);
    const context = canvas.getContext("2d");
    if (context && rows > 0) {
      const image = context.createImageData(columns, rows);
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const level = Math.pow(clamp01((values[row][column] - 30) / 70), 1.3);
          image.data.set([tint[0], tint[1], tint[2], Math.round(255 * level)], ((rows - 1 - row) * columns + column) * 4);
        }
      }
      context.putImageData(image, 0, 0);
    }
    // Drawn up four times larger with a soft blur, so the data reads as painted light, not pixels.
    const soft = document.createElement("canvas");
    soft.width = canvas.width * 4;
    soft.height = canvas.height * 4;
    const softContext = soft.getContext("2d");
    if (softContext) {
      softContext.imageSmoothingEnabled = true;
      softContext.filter = "blur(3px)";
      softContext.drawImage(canvas, 0, 0, soft.width, soft.height);
    }
    const texture = new CanvasTexture(soft);
    texture.colorSpace = SRGBColorSpace;
    return new Mesh(
      new PlaneGeometry(FIELD_WIDTH, FIELD_DEPTH * 0.62),
      new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
  }

  /** A point on the field (its own frame) above a moment and a pitch, riding the terrain. */
  private fieldPoint(seconds: number, hz: number, above = STAR_LIFT): Vector3 {
    return new Vector3(this.field.x(seconds), this.field.y(hz), above + this.field.level(seconds, hz) * TERRAIN_HEIGHT * this.field.grow);
  }

  private toWorld(local: Vector3): Vector3 {
    return this.field.group.localToWorld(local.clone());
  }

  // --- Camera poses --------------------------------------------------------------------------

  /** Where each beat wants the camera, at `t` seconds into the beat. */
  private pose(chapter: ChapterId, t: number): Pose {
    const at = (position: [number, number, number], target: [number, number, number]): Pose => ({
      position: new Vector3(...position),
      target: new Vector3(...target),
    });
    const calm = this.reducedMotion ? 0 : 1;
    switch (chapter) {
      case "sound":
        return at([0, 2.6, 15.6 - Math.min(t, 12) * 0.18 * calm], [0, 2.6, 0]);
      case "spectrum": {
        // Face-on while the beam paints, then a crane up and around as the sky lies down.
        const lay = easeInOut((this.tilt - 0.05) / 0.95);
        // Centred and a little raised: the whole field in frame, the evening horizon behind it.
        const pose = at([0, 2.6 + 1.4 * lay, 15.6 - 2.4 * lay], [0, 2.6 - 1.6 * lay, -3.5 * lay]);
        return pose;
      }
      case "stars": {
        // A low sweep along the time axis, just above the summits: stars pass by the lens.
        // The highlight shows this beat for a few seconds, so it starts mid-sweep where stars are.
        const start = this.highlight ? 0.35 : 0;
        const sweep = this.reducedMotion ? 0.3 : start + (1 - start) * (0.5 - 0.5 * Math.cos((t / 26) * Math.PI));
        const x = -10.5 + sweep * 15;
        return at([x * 0.6, 2.4, 6.5], [x * 0.6 + 2.5, 0.8, -3.5]);
      }
      case "fingerprint": {
        const focus = this.pairFocus;
        return {
          position: focus.clone().add(new Vector3(2.2 + Math.sin(t * 0.2) * 0.3 * calm, 1.5, 6.4)),
          target: focus.clone().add(new Vector3(1.4, 0.2, -1.4)),
        };
      }
      case "catalog":
        return at([0, 80, 40 - Math.min(t, 14) * 0.8 * calm], [0, 90, -130]);
      case "warp":
        return at([0, 7.8, 11.5 - Math.min(t, 10) * 0.12 * calm], [0, 1.2, -3.2]);
      case "voice":
        return at([0, 4.2, 18.5 - Math.min(t, 14) * 0.1 * calm], [0, 3.9, -0.5]);
      case "musubi": {
        // A slow push-in through the slide, then a hard punch forward on the lock and a drift back.
        const since = t - LOCK_AT;
        const punch = since < 0 ? 0 : since < 0.35 ? easeOut(since / 0.35) : 1 - 0.75 * easeInOut((since - 0.35) / 2.4);
        const push = Math.min(t, LOCK_AT) * 0.28;
        return at([0.8, 4.6 - punch * 0.6 * calm, 11.5 - (push + punch * 2.6) * calm], [0, 2.2 + punch * 0.4, -5]);
      }
      case "listen": {
        const angle = -0.5 + t * 0.1 * calm;
        return at([Math.sin(angle) * 12, 4.6, -3.5 + Math.cos(angle) * 12], [0, 1.2, -3.5]);
      }
      case "verdict":
        return at([0, 9, 24 + Math.min(t, 16) * 0.5 * calm], [0, 5, -20]);
    }
  }

  /**
   * Every pose is composed for a 16:9 screen. On a narrower window the camera eases back along
   * its line of sight, so the same things stay in frame instead of being cropped at the sides.
   */
  private fit(pose: Pose): Pose {
    const aspect = this.camera.aspect;
    if (aspect >= 1.7) return pose;
    const back = Math.pow(1.7 / Math.max(aspect, 0.6), 0.85);
    return { position: pose.target.clone().add(pose.position.clone().sub(pose.target).multiplyScalar(back)), target: pose.target };
  }

  // --- Public controls -----------------------------------------------------------------------

  goTo(chapter: ChapterId) {
    const now = performance.now();
    this.resetLock();
    const first = this.chapterStarted === 0;
    this.chapter = chapter;
    this.chapterStarted = now;
    this.listenStarted = null;
    this.fired.clear();
    if (!first) {
      this.rig.flyTo(this.fit(this.pose(chapter, 2.5)), now);
      this.onCue?.("whoosh");
    }
  }

  replayChapter() {
    this.chapterStarted = performance.now();
    this.fired.clear();
    this.resetLock();
    if (this.chapter === "listen") this.listenStarted = performance.now();
  }

  private resetLock() {
    this.debrisStarted = -1;
    this.lockKicked = false;
    this.lockPlayed = false;
    this.shock = null;
    for (let index = 0; index < 4; index += 1) this.lake.ring(index, 0, 0, 0, 0);
  }

  /** Play a cue once per visit to a beat. */
  private cue(cue: Cue, key: string = cue) {
    if (this.fired.has(key)) return;
    this.fired.add(key);
    this.onCue?.(cue);
  }

  /** The storm's strength, 0 to 1, for the rain sound. */
  stormLevel(): number {
    return this.noiseLevel;
  }

  setNoise(on: boolean) {
    this.noise = on;
  }

  startListening() {
    this.listenStarted = performance.now();
  }

  listenTime(): number {
    if (this.listenStarted === null) return 0;
    return Math.min(this.data.duration, (performance.now() - this.listenStarted) / 1000);
  }

  resize() {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    for (const strokes of [this.pairStrokes, this.zoneStrokes, this.webStrokes, this.threads, this.curveStrokes, this.curveCursor, this.contourQuery, this.contourSong, this.dtwThreads]) {
      strokes.material.resolution.set(width, height);
    }
  }

  // --- Per frame -----------------------------------------------------------------------------

  frame(now: number): WorldLabel[] {
    const local = (now - this.chapterStarted) / 1000;
    const labels: WorldLabel[] = [];
    this.shared.uTime.value = now / 1000;
    this.animateChapter(local, labels);
    this.scene.updateMatrixWorld();

    const delta = this.lastFrame > 0 ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.updateDebris(delta);
    this.rig.update(this.camera, this.fit(this.pose(this.chapter, Math.max(0, local))), now);
    this.scenery.update(this.camera, now / 1000, this.noiseLevel * 4, this.shock);
    // The film look joins once the 3D world is fully in (before that the canvas is see-through
    // over the painted sky, which post-processing would not preserve).
    if (this.post && this.shared.uScene.value > 0.97) {
      this.postBlend = Math.min(1, this.postBlend + delta * 1.5);
      this.post.render(now, { ...this.fx, bloom: this.fx.bloom * this.postBlend });
    } else {
      this.postBlend = 0;
      this.renderer.render(this.scene, this.camera);
    }

    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    // Labels stay on screen: a label near an edge slides inward rather than being cut off.
    return this.declutter(labels).map((label) => ({
      ...label,
      x: Math.min(0.8, Math.max(0.02, label.x)) * width,
      y: Math.min(0.72, Math.max(0.08, label.y)) * height,
    }));
  }

  /** Drop labels that would overlap one placed before them (earlier labels have priority). */
  private declutter(labels: WorldLabel[]): WorldLabel[] {
    const placed: WorldLabel[] = [];
    for (const label of labels) {
      if (!label.visible) continue;
      const clash = placed.some((other) => Math.abs(other.x - label.x) < 0.13 && Math.abs(other.y - label.y) < 0.07);
      if (!clash) placed.push(label);
    }
    return placed;
  }

  private project(point: Vector3): { x: number; y: number; visible: boolean } {
    const projected = point.clone().project(this.camera);
    return {
      x: (projected.x + 1) / 2,
      y: (1 - projected.y) / 2,
      visible: projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05,
    };
  }

  private animateChapter(local: number, labels: WorldLabel[]) {
    const chapter = this.chapter;
    const t = this.reducedMotion ? 1e3 : local;
    const data = this.data;

    // --- The field's pose: standing sky, the drawbridge, or laid mountains.
    let tiltTarget = 1;
    let fieldOpacity = 1;
    let reveal = 1.01;
    let beam = 0;
    let night = 0.55;
    let starLevel = 0;
    let revealStarsUntil = data.duration;
    let waveform = 0;
    let galaxy = 0;
    let song = 0;
    let voice = 0;

    switch (chapter) {
      case "sound":
        tiltTarget = 0;
        night = 0.35;
        fieldOpacity = 1 - 0.8 * easeOut((t - 0.8) / 1.6);
        waveform = 0.85 * easeOut((t - 0.8) / 2.5);
        break;
      case "spectrum": {
        night = 0.4;
        // The highlight opens on the finished picture; class mode paints it with the beam first.
        const paintFor = this.highlight ? 0 : 5;
        const paintStart = this.highlight ? 0 : 0.8;
        reveal = paintFor > 0 ? clamp01((t - paintStart) / paintFor) : 1.01;
        beam = reveal > 0 && reveal < 1 ? 0.9 : 0;
        const layAt = this.highlight ? 1.4 : 6.4;
        tiltTarget = this.reducedMotion ? 1 : easeInOut((t - layAt) / 3);
        waveform = 0.85 * (1 - tiltTarget);
        starLevel = tiltTarget > 0.6 ? easeOut((tiltTarget - 0.6) / 0.4) : 0;
        revealStarsUntil = data.duration * clamp01((tiltTarget - 0.6) / 0.4);
        break;
      }
      case "stars":
        starLevel = 1;
        night = 0.6 + 0.25 * this.noiseLevel;
        revealStarsUntil = data.duration * clamp01((t - 0.4) / 4.5);
        break;
      case "fingerprint":
        starLevel = 0.6;
        night = 0.62;
        break;
      case "catalog":
        starLevel = 0.8;
        night = 0.75;
        galaxy = easeOut(t / 2.5);
        break;
      case "musubi":
        starLevel = 0.85;
        night = 0.68;
        song = easeOut(t / 1.8);
        galaxy = Math.max(0, 1 - t / 1.5) * 0.6;
        break;
      case "warp":
        starLevel = 1;
        night = 0.62;
        song = 1;
        break;
      case "voice":
        starLevel = 0.15;
        night = 0.62;
        fieldOpacity = 0.55;
        voice = 1;
        break;
      case "listen":
        starLevel = 0.5;
        night = 0.58;
        break;
      case "verdict":
        starLevel = 0.9;
        night = 0.5;
        break;
    }

    // Tilt eases toward its target; the drawbridge itself is driven directly so it stays exact.
    this.tilt = chapter === "spectrum" ? tiltTarget : this.tilt + (tiltTarget - this.tilt) * 0.06;
    const grow = this.tilt;
    this.field.pose(this.tilt, grow);
    this.field.lightFrom(SUN_DIRECTION.clone().negate().setY(0.7).normalize());
    this.field.reveal(reveal);
    this.field.beamAt(Math.min(1, reveal), beam);
    const opacity = this.field.material.uniforms.uOpacity.value as number;
    this.field.opacity(opacity + (fieldOpacity - opacity) * 0.08);
    const liftScale = TERRAIN_HEIGHT * grow;
    for (const field of [this.stars, this.songStars, this.knots]) field.material.uniforms.uLiftScale.value = liftScale;

    // The 3D evening fades in as the sky lies down, and stays once it has been seen.
    if (this.tilt > 0.95) this.sceneSeen = true;
    const sceneTarget = this.sceneSeen ? 1 : clamp01((this.tilt - 0.05) / 0.6);
    this.shared.uScene.value += (sceneTarget - this.shared.uScene.value) * 0.08;
    this.shared.uNight.value += (night - this.shared.uNight.value) * 0.03;

    // --- Waveform: standing in the sky for "sound", lying on the lake as the spectrum builds.
    this.waveformMaterial.opacity += (waveform - this.waveformMaterial.opacity) * 0.08;
    this.waveform.rotation.x = 0;
    this.waveform.position.set(0, FIELD_BASE + FIELD_DEPTH * 0.3, 1.2);
    this.waveform.visible = chapter === "sound" || chapter === "spectrum";
    const drawn = this.waveform.geometry.index?.count ?? 0;
    if (chapter === "sound") {
      this.waveform.geometry.setDrawRange(0, Math.floor((clamp01((t - 0.8) / 3.5) * drawn) / 6) * 6);
    } else {
      // The part of the wave the beam has passed has already flown into the sky.
      const consumed = this.highlight ? clamp01((t - 0.1) / 1.2) : clamp01((t - 0.8) / 5);
      const start = Math.floor((consumed * drawn) / 6) * 6;
      this.waveform.geometry.setDrawRange(start, Math.max(0, drawn - start));
    }
    this.shatter.update(t, chapter === "spectrum" && t < this.shatterEnd ? 1 : 0);

    // --- Noise: the ground turns jagged and hazy; the peaks do not move.
    this.noiseLevel += ((chapter === "stars" && this.noise ? 1 : 0) - this.noiseLevel) * 0.06;
    this.field.noise(this.noiseLevel);

    // --- Stars.
    const peaks = data.response.explanation.peaks;
    for (let index = 0; index < peaks.length; index += 1) {
      const appear = this.starTimes[index] <= revealStarsUntil ? 1 : 0;
      const glow = chapter === "listen" ? this.listenGlow(index) : 0;
      const tint = chapter === "musubi" ? (peaks[index].matched ? 1 : 0.4) : 1;
      // Through the storm the peaks burn brighter still: noise does not move them.
      const storm = chapter === "stars" ? 1 + 0.6 * this.noiseLevel : 1;
      this.stars.alpha(index, starLevel * appear * tint * storm + glow);
    }
    this.stars.commit();

    this.fx.bloom = 1;
    this.fx.flash = 0;
    this.fx.chroma = 0;
    this.fx.focus = chapter === "fingerprint" ? this.pairFocus : null;
    this.animateStorm(chapter, t);
    if ((chapter === "stars" && t > 0.6) || (chapter === "spectrum" && this.tilt > 0.7)) this.cue("ignite");
    this.animateFingerprints(chapter, t, labels);
    this.animateCatalog(chapter, t, galaxy, labels);
    this.animateAlignment(chapter, t, song, labels);
    this.animateEdits(chapter, t, labels);
    this.animateVoice(chapter, t, voice, labels);
  }

  private currentPair(local: number) {
    const pairs = this.data.response.explanation.pairExamples;
    if (pairs.length === 0) return null;
    return pairs[Math.min(pairs.length - 1, Math.floor(local / 3.2)) % pairs.length];
  }

  private animateFingerprints(chapter: ChapterId, t: number, labels: WorldLabel[]) {
    const data = this.data;
    const pair = this.currentPair(chapter === "fingerprint" ? t : 0);
    if (pair) this.pairFocus.copy(this.toWorld(this.fieldPoint(pair.anchorSeconds, pair.anchorFrequencyHz)));
    if (chapter !== "fingerprint" || !pair) {
      this.zoneVolume.span(new Vector3(), new Vector3(), 0);
      this.pulse.alpha(0, 0);
      this.pulse.commit();
      this.zoneStrokes.set([]);
      this.pairStrokes.set([]);
      this.webStrokes.set([]);
      return;
    }
    const anchor = this.fieldPoint(pair.anchorSeconds, pair.anchorFrequencyHz);
    const target = this.fieldPoint(pair.targetSeconds, pair.targetFrequencyHz);
    const config = data.response.explanation.signalConfig;
    const frameSeconds = config.hopLength / data.sampleRate;
    const binHz = data.sampleRate / config.fftSize;
    // The target zone: a box of air just ahead of the anchor, from the ground to above it.
    const x0 = this.field.x(pair.anchorSeconds + frameSeconds);
    const x1 = this.field.x(pair.anchorSeconds + 64 * frameSeconds);
    const y0 = this.field.y(Math.max(MIN_FREQUENCY_HZ, pair.anchorFrequencyHz - 150 * binHz));
    const y1 = this.field.y(pair.anchorFrequencyHz + 150 * binHz);
    const z1 = anchor.z + 0.9;
    const grow = easeOut(((t % 3.2) - 0.2) / 0.8);
    const xr = x0 + (x1 - x0) * grow;
    const box: number[] = [];
    if (grow > 0) {
      const corners = [
        [x0, y0], [xr, y0], [xr, y1], [x0, y1],
      ];
      for (let index = 0; index < 4; index += 1) {
        const [ax, ay] = corners[index];
        const [bx, by] = corners[(index + 1) % 4];
        box.push(ax, ay, 0, bx, by, 0, ax, ay, z1, bx, by, z1, ax, ay, 0, ax, ay, z1);
      }
    }
    this.zoneStrokes.set(box);
    this.zoneVolume.span(new Vector3(x0, y0, 0), new Vector3(xr, y1, z1), grow > 0 ? 0.28 * grow : 0);
    const draw = easeOut(((t % 3.2) - 0.9) / 0.9);
    const pairSegments: number[] = [];
    if (draw > 0) arc(pairSegments, anchor, anchor.clone().lerp(target, draw), 0.6 * draw, 12);
    this.pairStrokes.set(pairSegments);
    // A pulse of light runs along the arc: the two stars becoming one number.
    const run = clamp01(((t % 3.2) - 1.0) / 1.1);
    const along = anchor.clone().lerp(target, run);
    along.z += Math.sin(Math.PI * run) * 0.6;
    this.pulse.move(0, along.x, along.y, along.z);
    this.pulse.alpha(0, run > 0 && run < 1 ? 1.4 : 0);
    this.pulse.commit(true);
    const screen = this.project(this.toWorld(anchor.clone().add(new Vector3(0, 0, 0.5))));
    labels.push({
      id: "hash",
      text: `${Math.round(pair.anchorFrequencyHz)} Hz → ${Math.round(pair.targetFrequencyHz)} Hz, ${(pair.deltaFrames * frameSeconds).toFixed(2)} s apart`,
      detail: "hashed together into one 64-bit fingerprint",
      tone: "lantern",
      x: screen.x,
      y: screen.y,
      visible: screen.visible && draw > 0.6,
    });
    const web: number[] = [];
    if (t > 3) {
      for (const fingerprint of data.response.explanation.matchedFingerprints.slice(0, 220)) {
        arc(
          web,
          this.fieldPoint(fingerprint.queryAnchorSeconds, fingerprint.anchorFrequencyHz),
          this.fieldPoint(fingerprint.queryTargetSeconds, fingerprint.targetFrequencyHz),
          0.25,
          4,
        );
      }
    }
    this.webStrokes.set(web);
    this.webStrokes.material.opacity = 0.3 * clamp01((t - 3) / 2);
  }

  private animateCatalog(chapter: ChapterId, t: number, galaxy: number, labels: WorldLabel[]) {
    const winnerId = this.data.response.recognition.song?.id;
    const top = [...this.clusters].sort((a, b) => b.hits - a.hits).slice(0, 5);
    // The winner is labelled first, so it is never the one dropped when labels would overlap.
    const ordered = [...this.clusters].sort((a, b) => Number(b.songId === winnerId) - Number(a.songId === winnerId));
    for (const cluster of ordered) {
      const clusterIndex = this.clusters.indexOf(cluster);
      const heat = chapter === "catalog" ? clamp01((t - 2) / 4) : chapter === "musubi" ? 1 : 0;
      const winner = cluster.songId === winnerId;
      // After the storm has done its work, the wrong songs flicker and dim; the right one blazes.
      const verdict = chapter === "catalog" ? clamp01((t - 6) / 2) : 0;
      const flicker = 0.75 + 0.25 * Math.sin(t * 9 + clusterIndex * 2.1);
      const fate = winner ? 1 + 0.9 * verdict * (0.85 + 0.15 * Math.sin(t * 4)) : 1 - 0.82 * verdict * flicker;
      for (const seed of cluster.seeds) {
        this.clusterField.alpha(seed, galaxy * (0.3 + 0.7 * heat * Math.min(1, cluster.hits / 400)) * (winner ? 1.3 : 0.85) * fate);
      }
      if (chapter === "catalog" && (top.includes(cluster) || winner)) {
        const screen = this.project(cluster.center.clone().add(new Vector3(0, 6, 0)));
        labels.push({
          id: `song-${cluster.songId}`,
          text: cluster.name,
          detail: `${cluster.hits.toLocaleString("en-US")} hash hits`,
          tone: winner ? "comet" : "star",
          x: screen.x,
          y: screen.y,
          visible: screen.visible && t > 4,
        });
      }
    }
    this.clusterField.commit();
    this.meteors.update(t - 1.5, chapter === "catalog" ? 1 : 0);
  }

  private animateAlignment(chapter: ChapterId, t: number, song: number, labels: WorldLabel[]) {
    const data = this.data;
    const musubi = chapter === "musubi";
    const since = t - LOCK_AT;
    const locked = musubi && since >= 0;
    const winner = this.clusters.find((cluster) => cluster.songId === data.response.recognition.song?.id);
    if (musubi || chapter === "warp") {
      // 1. The winning constellation descends from the galaxy.
      const arrive = musubi ? easeInOut(t / 2.2) : 1;
      // 2. It slides across the recording, slowing as if time itself slowed, then snaps home.
      const progress = clamp01((t - 2.4) / (LOCK_AT - 2.4));
      const approach = !musubi || locked ? 1 : 0.965 * (1 - Math.pow(1 - progress, 2.6));
      const worldOrigin = winner?.center ?? GALAXY_CENTER;
      // The constellation's home in the field's frame (laid: world y is local z).
      const origin = new Vector3(worldOrigin.x, -worldOrigin.z, worldOrigin.y - FIELD_BASE);
      const home = new Vector3((1 - approach) * 3.4, 0, (1 - approach) * 1.2);
      this.songGroup.position.lerpVectors(origin, home, arrive);
      this.songGroup.scale.setScalar(0.12 + 0.88 * arrive);
    }
    for (let index = 0; index < this.songStars.count; index += 1) {
      this.songStars.alpha(index, song * (locked ? 0.95 + Math.max(0, 1 - since * 1.5) : 0.95));
    }
    this.songStars.commit();

    // 3. On the lock every thread fires at once, and each knot ignites.
    const segments: number[] = [];
    const end = new Vector3();
    const fire = locked ? easeOut(since / 0.35) : 0;
    const winningPillar = this.pillarMeshes.find((pillar) => pillar.winning);
    // The pillar's crown in the field's frame (laid: world y is local z, world -z is local y).
    const crown = winningPillar
      ? new Vector3(winningPillar.mesh.position.x, -winningPillar.mesh.position.z, winningPillar.mesh.scale.y * 0.82 - FIELD_BASE)
      : new Vector3(0, FIELD_DEPTH + 1, 4);
    this.threadPairs.forEach((pair, index) => {
      if (fire > 0) {
        end.copy(pair.query).lerp(crown, fire);
        arc(segments, pair.query, end, 1.2 + (index % 7) * 0.25, 10);
      }
      const knot = locked ? easeOut(since / 0.3) : 0;
      this.knots.alpha(index, knot * (1 + Math.sin(t * 6 + index) * 0.2) + (locked ? Math.max(0, 1 - since * 2) : 0));
      this.knots.size(index, 2.4 + knot * 1.4);
    });
    this.threads.set(musubi ? segments : []);
    this.threads.material.linewidth = 2.4;
    this.threads.material.opacity = locked ? 1 - 0.45 * clamp01((since - 1.5) / 1.5) : 0;
    this.knots.commit();

    // Offset votes rise from the lake while the constellation slides.
    const rise = musubi ? easeOut((t - 2.2) / 2) : 0;
    const crumble = locked ? clamp01(since / 0.7) : 0;
    this.pillarMeshes.forEach(({ mesh, height, winning }, index) => {
      const grown = height * clamp01(rise * 1.3 - index * 0.004);
      // 4. The false pillars break; the true one blazes taller.
      const scale = winning ? grown * (1 + 0.18 * crumble) : grown * (1 - crumble);
      mesh.scale.y = Math.max(0.001, scale);
      mesh.position.y = mesh.scale.y / 2;
      const flicker = winning || !locked ? 1 : 0.6 + hash(index + t * 40) * 0.4;
      (mesh.material as ShaderMaterial).uniforms.uOpacity.value = rise * (winning ? 1 : 0.55 * (1 - crumble) * flicker);
    });
    if (locked && this.debrisStarted < 0) this.startDebris();

    // 5. Flash, a shockwave across the lake and through the clouds, a kick, a bloom surge.
    const winning = this.pillarMeshes.find((pillar) => pillar.winning);
    const center = winning ? winning.mesh.position : new Vector3(0, 0, -FIELD_DEPTH);
    if (locked) {
      this.fx.flash = since < 0.45 ? Math.pow(1 - since / 0.45, 2) * 0.9 : 0;
      this.fx.chroma = Math.exp(-since * 4);
      this.fx.bloom = 1 + 2.4 * Math.exp(-since * 1.8);
      if (!this.lockKicked) {
        this.lockKicked = true;
        this.rig.kick(0.9);
        this.cue("lock");
      }
      const fade = Math.max(0, 1 - since / 3.2);
      this.lake.ring(0, center.x, center.z, since * 30, fade);
      this.lake.ring(1, center.x, center.z, Math.max(0, since - 0.3) * 22, fade * 0.6);
      this.shock = { x: center.x, z: center.z, radius: since * 45, strength: Math.max(0, 1 - since / 5) };
      // 6. The recording plays: the very sound that was matched.
      if (!this.lockPlayed && since > 0.5) {
        this.lockPlayed = true;
        this.onLock?.();
      }
    } else if (musubi) {
      if (t > LOCK_AT - 3.6) this.cue("riser");
      // The slow-motion approach: the glow gathers before the impact.
      this.fx.bloom = 1 + 0.5 * clamp01((t - 3.5) / (LOCK_AT - 3.5));
    }

    if (musubi && winning && rise > 0.5) {
      const decision = data.response.explanation.decision;
      const top = this.project(new Vector3(center.x, winning.mesh.scale.y + 0.5, center.z));
      labels.push({
        id: "pillar",
        text: `${decision.leadingVotes} fingerprints agree`,
        detail: `the next best position has ${decision.runnerUpVotes}`,
        tone: "thread",
        x: top.x,
        y: Math.max(0.12, top.y),
        visible: top.visible && (!locked || since > 1.4),
      });
    }
    // 7. The song's name lands above the true offset.
    if (locked && since > 1.6 && data.response.recognition.song) {
      const title = this.project(new Vector3(center.x + 1.6, winning ? winning.mesh.scale.y * 0.5 : 3, center.z));
      labels.push({
        id: "title",
        text: data.response.recognition.song.name,
        detail: "the moment every thread agrees",
        tone: "comet",
        x: title.x,
        y: title.y,
        visible: title.visible,
      });
    }
  }

  /**
   * Noise as a storm: rain, wind in the clouds, choppy water, and now and then lightning that
   * lights the whole lake. The stars stay lit through all of it: that is the lesson.
   */
  private animateStorm(chapter: ChapterId, t: number) {
    const storm = this.noiseLevel;
    this.rain.update(this.shared.uTime.value, storm * 0.42);
    if (chapter !== "stars" || storm < 0.6) {
      this.nextBolt = t + 1.2;
      return;
    }
    if (t >= this.nextBolt) {
      this.boltAt = t;
      this.nextBolt = t + 2.6 + hash(Math.floor(t * 10)) * 2.2;
      this.fired.delete("thunder");
      this.cue("thunder");
    }
    // Two quick strokes, never more than three flashes a second.
    const since = t - this.boltAt;
    const strike = since < 0 ? 0 : since < 0.09 ? 1 : since < 0.17 ? 0.15 : since < 0.28 ? 0.75 : Math.exp(-(since - 0.28) * 7) * 0.75;
    if (!this.reducedMotion && strike > 0.01) {
      this.fx.flash = Math.max(this.fx.flash, strike * 0.2);
      this.shared.uNight.value = Math.max(0.1, this.shared.uNight.value - strike * 0.05);
    }
  }

  private startDebris() {
    this.debrisStarted = performance.now();
    for (let index = 0; index < this.debris.count; index += 1) {
      const home = this.debrisHome[index];
      const y = hash(index * 1.3) * home.height;
      this.debris.set(index, [home.x + (hash(index * 2.1) - 0.5) * 0.12, y, home.z + (hash(index * 3.7) - 0.5) * 0.12], 0.7 + hash(index) * 0.8, COLORS.star, 0.9);
      this.debrisVelocity[index * 3] = (hash(index * 4.9) - 0.5) * 2.2;
      this.debrisVelocity[index * 3 + 1] = hash(index * 6.1) * 2.4;
      this.debrisVelocity[index * 3 + 2] = (hash(index * 8.3) - 0.5) * 2.2;
    }
    this.debris.commit(true);
  }

  /** Sparks fall under gravity and go out when they reach the water. */
  private updateDebris(delta: number) {
    if (this.debrisStarted < 0) {
      for (let index = 0; index < this.debris.count; index += 1) this.debris.alpha(index, 0);
      this.debris.commit();
      return;
    }
    for (let index = 0; index < this.debris.count; index += 1) {
      const y = this.debris.y(index);
      if (y <= 0) {
        this.debris.alpha(index, 0);
        continue;
      }
      this.debrisVelocity[index * 3 + 1] -= 9.8 * delta;
      this.debris.move(
        index,
        this.debris.x(index) + this.debrisVelocity[index * 3] * delta,
        Math.max(0, y + this.debrisVelocity[index * 3 + 1] * delta),
        this.debris.z(index) + this.debrisVelocity[index * 3 + 2] * delta,
      );
    }
    this.debris.commit(true);
  }

  private animateEdits(chapter: ChapterId, t: number, labels: WorldLabel[]) {
    const data = this.data;
    const terrain = this.field.terrain;
    if (chapter === "warp" && data.evidence?.speedCurve) {
      const curve = data.evidence.speedCurve.filter((point) => point.pitchFactor === point.speedFactor);
      const sweep = easeInOut(clamp01((t - 0.8) / 6));
      const found = data.speedFactor;
      const lowest = curve[0]?.speedFactor ?? 0.75;
      const highest = curve[curve.length - 1]?.speedFactor ?? 1.35;
      const guess = t < 7 ? lowest + (highest - lowest) * sweep : found;
      const settle = t < 7 ? 0 : easeOut((t - 7) / 1.2);
      const factor = t < 7 ? guess : guess + (found - guess) * settle;
      const ratio = factor / found;
      // The whole range stretches like an accordion: time × ratio, pitch ÷ ratio.
      terrain.scale.x = ratio;
      terrain.position.x = -FIELD_WIDTH / 2 + (FIELD_WIDTH / 2) * ratio;
      terrain.position.y = (-FIELD_DEPTH * Math.log(Math.max(ratio, 1e-3))) / Math.log(MAX_FREQUENCY_HZ / MIN_FREQUENCY_HZ);
      data.response.explanation.peaks.forEach((peak, index) => {
        this.stars.move(index, this.field.x((peak.timeSeconds * factor) / found), this.field.y((peak.frequencyHz / factor) * found), STAR_LIFT);
      });
      this.stars.commit(true);
      const maxVotes = Math.max(1, ...curve.map((point) => point.votes));
      const curveX = (value: number) => -0.4 + ((value - lowest) / (highest - lowest)) * (FIELD_WIDTH / 2 - 0.2);
      const curveY = (votes: number) => 0.1 + (votes / maxVotes) * 4.4;
      // The vote curve stands in the lake behind the mountains, rising above their ridges.
      const curveZ = -FIELD_DEPTH - 1.2;
      const segments: number[] = [];
      curve.forEach((point, index) => {
        if (index === 0) return;
        const previous = curve[index - 1];
        segments.push(curveX(previous.speedFactor), curveY(previous.votes), curveZ, curveX(point.speedFactor), curveY(point.votes), curveZ);
      });
      this.curveStrokes.set(segments);
      const reached = curve.filter((point) => point.speedFactor <= Math.max(guess, factor) + 1e-6);
      this.curveCurtain.set(reached.flatMap((point) => [curveX(point.speedFactor), curveY(point.votes), curveZ]), 0, 0.5);
      const cursorX = curveX(factor);
      this.curveCursor.set([cursorX, 0, curveZ, cursorX, 4.7, curveZ]);
      const screen = this.project(new Vector3(cursorX, 5, curveZ));
      labels.push({
        id: "speed",
        text: `${factor.toFixed(2)}×`,
        detail: t >= 7 ? `${Math.round(found * 100)}% speed: the stars line up` : "trying speeds…",
        tone: t >= 7 ? "comet" : "lantern",
        x: screen.x,
        y: screen.y,
        visible: screen.visible,
      });
      return;
    }
    this.curveStrokes.set([]);
    this.curveCursor.set([]);
    this.curveCurtain.set([], 0, 0);
    terrain.scale.x += (1 - terrain.scale.x) * 0.15;
    terrain.position.x += (0 - terrain.position.x) * 0.15;
    terrain.position.y += (0 - terrain.position.y) * 0.15;
    this.restoreStars();
  }

  private restoreStars() {
    const peaks = this.data.response.explanation.peaks;
    let moved = false;
    peaks.forEach((peak, index) => {
      const x = this.field.x(peak.timeSeconds);
      const y = this.field.y(peak.frequencyHz);
      const px = this.stars.x(index);
      const py = this.stars.y(index);
      if (Math.abs(px - x) > 1e-4 || Math.abs(py - y) > 1e-4) {
        this.stars.move(index, px + (x - px) * 0.15, py + (y - py) * 0.15, STAR_LIFT);
        moved = true;
      }
    });
    if (moved) this.stars.commit(true);
  }

  private animateVoice(chapter: ChapterId, t: number, voice: number, labels: WorldLabel[]) {
    const melody = this.data.evidence?.melody;
    const mix = this.mixPlane;
    const vocal = this.vocalPlane;
    const base = FIELD_BASE + FIELD_DEPTH * 0.35;
    if (mix && vocal) {
      const separate = chapter === "voice" ? easeInOut((t - 1) / 2.4) : 0;
      (mix.material as MeshBasicMaterial).opacity = 0.6 * voice * (1 - 0.6 * separate) * (t < 6 ? 1 : Math.max(0.15, 1 - (t - 6) / 1.5));
      (vocal.material as MeshBasicMaterial).opacity = 0.7 * voice * (0.2 + 0.8 * separate) * (t < 6 ? 1 : Math.max(0.2, 1 - (t - 6) / 1.5));
      vocal.position.y = base + separate * 2.6;
      vocal.position.z = 1.0 + separate * 1.4;
    }
    if (!(melody && chapter === "voice" && t > 6)) {
      this.queryCurtain.set([], 0, 0);
      this.songCurtain.set([], 0, 0);
      this.contourQuery.set([]);
      this.contourSong.set([]);
      this.dtwThreads.set([]);
      return;
    }
    const z = 1.6;
    const draw = clamp01((t - 6) / 2.5);
    // A robust pitch range: octave slips in the pitch track should not flatten everything else.
    const sorted = [...melody.song, ...melody.queryShifted].sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.05)] ?? 48;
    const high = sorted[Math.floor(sorted.length * 0.95)] ?? 72;
    const span = Math.max(4, high - low);
    const pitchY = (midi: number) => FIELD_BASE + 1.4 + ((Math.min(high + 2, Math.max(low - 2, midi)) - low) / span) * (FIELD_DEPTH - 2.8);
    const slide = easeInOut((t - 9) / 1.6);
    const qx = (index: number) => -FIELD_WIDTH * 0.42 + (index / Math.max(1, melody.query.length - 1)) * FIELD_WIDTH * 0.84;
    // The original's notes sit where the warping path says they meet the singer's.
    const songToQuery = new Map<number, number[]>();
    for (const [queryIndex, songIndex] of melody.path) {
      const list = songToQuery.get(songIndex) ?? [];
      list.push(queryIndex);
      songToQuery.set(songIndex, list);
    }
    const songIndices = [...songToQuery.keys()].sort((a, b) => a - b);
    const sx = (songIndex: number) => {
      const matches = songToQuery.get(songIndex);
      return matches ? qx(matches.reduce((sum, value) => sum + value, 0) / matches.length) : 0;
    };
    const queryHeight = (index: number) => pitchY(melody.queryShifted[index] - (1 - slide) * (melody.queryShifted[index] - melody.query[index]));
    const queryLine: number[] = [];
    const shown = Math.floor(melody.query.length * draw);
    for (let index = 1; index < shown; index += 1) {
      queryLine.push(qx(index - 1), queryHeight(index - 1), z + 0.1, qx(index), queryHeight(index), z + 0.1);
    }
    const songLine: number[] = [];
    const songShown = Math.floor(songIndices.length * draw);
    for (let index = 1; index < songShown; index += 1) {
      const a = songIndices[index - 1];
      const b = songIndices[index];
      if (a >= melody.song.length || b >= melody.song.length) continue;
      songLine.push(sx(a), pitchY(melody.song[a]), z, sx(b), pitchY(melody.song[b]), z);
    }
    this.contourQuery.set(queryLine);
    this.contourSong.set(songLine);
    const floor = pitchY(low) - 0.6;
    const queryPoints: number[] = [];
    for (let index = 0; index < shown; index += 1) queryPoints.push(qx(index), queryHeight(index), z + 0.1);
    this.queryCurtain.set(queryPoints, floor, 0.13);
    const songPoints: number[] = [];
    for (let index = 0; index < songShown; index += 1) {
      const songIndex = songIndices[index];
      if (songIndex < melody.song.length) songPoints.push(sx(songIndex), pitchY(melody.song[songIndex]), z);
    }
    this.songCurtain.set(songPoints, floor, 0.09);
    const tie = clamp01((t - 11) / 1.5);
    const dtw: number[] = [];
    if (tie > 0) {
      melody.path.slice(0, Math.floor(melody.path.length * tie)).forEach(([queryIndex, songIndex], index) => {
        if (index % 2 === 1 || queryIndex >= melody.query.length || songIndex >= melody.song.length) return;
        dtw.push(qx(queryIndex), queryHeight(queryIndex), z + 0.1, sx(songIndex), pitchY(melody.song[songIndex]), z);
      });
    }
    this.dtwThreads.set(dtw);
    if (slide > 0.9) {
      const screen = this.project(new Vector3(qx(0), pitchY(high) + 0.6, z));
      const shift = melody.keyShiftSemitones;
      labels.push({
        id: "key",
        text: shift === 0 ? "same key as the original" : `sung ${Math.abs(shift)} semitone${Math.abs(shift) === 1 ? "" : "s"} ${shift > 0 ? "higher" : "lower"}`,
        detail: "the singer (lantern) against the original melody (teal)",
        tone: "lantern",
        x: screen.x,
        y: screen.y,
        visible: screen.visible,
      });
    }
  }

  private listenGlow(index: number): number {
    if (this.listenStarted === null) return 0;
    const since = this.listenTime() - this.starTimes[index];
    return since >= 0 && since < 0.35 ? 1.4 * (1 - since / 0.35) : 0;
  }

  dispose() {
    for (const field of [this.stars, this.songStars, this.knots, this.clusterField, this.debris, this.pulse]) field.dispose();
    for (const effect of [this.rain, this.shatter, this.meteors, this.zoneVolume, this.curveCurtain, this.queryCurtain, this.songCurtain]) effect.dispose();
    this.post?.dispose();
    for (const strokes of [this.pairStrokes, this.zoneStrokes, this.webStrokes, this.threads, this.curveStrokes, this.curveCursor, this.contourQuery, this.contourSong, this.dtwThreads]) {
      strokes.dispose();
    }
    this.scenery.dispose();
    this.lake.dispose();
    this.field.dispose();
    for (const group of [this.pillars, this.voiceGroup]) {
      group.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          const material = object.material as MeshBasicMaterial | ShaderMaterial;
          if ("map" in material && material.map) material.map.dispose();
          material.dispose();
        }
      });
    }
    this.waveform.geometry.dispose();
    this.waveformMaterial.dispose();
    this.sprite.dispose();
    this.renderer.dispose();
  }
}
