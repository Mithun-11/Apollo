/**
 * The replay's 3D world: the recording's sky standing over a lake, its stars at slightly
 * different depths, the catalog as a galaxy of song-skies behind it, and a camera that flies
 * between stops. Every object is built from measured data in ReplayData.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  InterleavedBufferAttribute,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { MAX_FREQUENCY_HZ, MIN_FREQUENCY_HZ, clamp01, easeInOut, easeOut } from "../sky/geometry";
import type { ReplayData } from "./data";

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
  | "speed"
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

const SKY_WIDTH = 16;
const SKY_HEIGHT = 7;
const SKY_BASE = 0.2;
const COLORS = {
  star: new Color("#fff6e6"),
  comet: new Color("#9fe3e0"),
  thread: new Color("#e2323f"),
  lantern: new Color("#ffc98a"),
  dim: new Color("#8f86b8"),
};
const MAX_THREADS = 140;

type Shot = { position: Vector3; target: Vector3 };

// At this distance and height the sky plane (y 0.2 to 7.2) spans 70% to 12% of the screen height
// and 75% of its width, exactly where the painted horizon and the live sky place it.
const WIDE_DISTANCE = 15.6;
const WIDE_HEIGHT = 2.6;

// ---------------------------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------------------------

const POINT_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.2, -mv.z);
  vAlpha = aAlpha;
  vColor = aColor;
}`;

const POINT_FRAGMENT = /* glsl */ `
uniform sampler2D uSprite;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 texel = texture2D(uSprite, gl_PointCoord);
  gl_FragColor = vec4(vColor * texel.rgb, texel.a * vAlpha);
}`;

function starSprite(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const middle = size / 2;
    const halo = context.createRadialGradient(middle, middle, 0, middle, middle, middle);
    halo.addColorStop(0, "rgba(255,255,255,1)");
    halo.addColorStop(0.1, "rgba(255,255,255,0.95)");
    halo.addColorStop(0.28, "rgba(255,255,255,0.28)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = halo;
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = "lighter";
    for (const horizontal of [true, false]) {
      const spike = horizontal
        ? context.createLinearGradient(0, middle, size, middle)
        : context.createLinearGradient(middle, 0, middle, size);
      spike.addColorStop(0, "rgba(255,255,255,0)");
      spike.addColorStop(0.5, "rgba(255,255,255,0.9)");
      spike.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = spike;
      if (horizontal) context.fillRect(0, middle - 1.2, size, 2.4);
      else context.fillRect(middle - 1.2, 0, 2.4, size);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

class StarField {
  readonly object: Points;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly colors: Float32Array;
  readonly count: number;

  constructor(count: number, sprite: CanvasTexture, scale: number) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.alphas = new Float32Array(count);
    this.sizes = new Float32Array(count);
    this.colors = new Float32Array(count * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setAttribute("aAlpha", new BufferAttribute(this.alphas, 1));
    geometry.setAttribute("aSize", new BufferAttribute(this.sizes, 1));
    geometry.setAttribute("aColor", new BufferAttribute(this.colors, 3));
    const material = new ShaderMaterial({
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      uniforms: { uSprite: { value: sprite }, uScale: { value: scale } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.object = new Points(geometry, material);
    this.object.frustumCulled = false;
  }

  set(index: number, position: Vector3 | [number, number, number], size: number, color: Color, alpha: number) {
    const [x, y, z] = Array.isArray(position) ? position : [position.x, position.y, position.z];
    this.positions.set([x, y, z], index * 3);
    this.sizes[index] = size;
    this.colors.set([color.r, color.g, color.b], index * 3);
    this.alphas[index] = alpha;
  }

  alpha(index: number, value: number) {
    this.alphas[index] = value;
  }

  size(index: number, value: number) {
    this.sizes[index] = value;
  }

  move(index: number, x: number, y: number, z: number) {
    this.positions[index * 3] = x;
    this.positions[index * 3 + 1] = y;
    this.positions[index * 3 + 2] = z;
  }

  position(index: number): Vector3 {
    return new Vector3(this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2]);
  }

  commit(positions = false) {
    const geometry = this.object.geometry;
    (geometry.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aSize") as BufferAttribute).needsUpdate = true;
    if (positions) (geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.object.geometry.dispose();
    (this.object.material as ShaderMaterial).dispose();
  }
}

class Strokes {
  readonly object: LineSegments2;
  readonly material: LineMaterial;
  private readonly geometry: LineSegmentsGeometry;
  private readonly buffer: Float32Array;
  private readonly capacity: number;

  constructor(color: Color, width: number, opacity = 1, capacity = 64) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity * 6);
    this.geometry = new LineSegmentsGeometry();
    this.geometry.setPositions(this.buffer);
    this.material = new LineMaterial({
      color: color.getHex(),
      linewidth: width,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.object = new LineSegments2(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.set([]);
  }

  /** Flat list of segment endpoints: x1,y1,z1,x2,y2,z2 per segment. */
  set(segments: number[]) {
    const count = Math.min(this.capacity, Math.floor(segments.length / 6));
    this.buffer.set(count * 6 === segments.length ? segments : segments.slice(0, count * 6));
    this.geometry.instanceCount = count;
    (this.geometry.getAttribute("instanceStart") as InterleavedBufferAttribute).data.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function pushCurve(out: number[], from: Vector3, to: Vector3, sag: number, steps = 8) {
  let previous = from.clone();
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const point = from.clone().lerp(to, t);
    point.y -= Math.sin(Math.PI * t) * sag;
    out.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
    previous = point;
  }
}

/** A soft-edged mask so glow planes fade out instead of ending in a straight line. */
function featherTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const horizontal = context.createLinearGradient(0, 0, 128, 0);
    horizontal.addColorStop(0, "#000");
    horizontal.addColorStop(0.08, "#fff");
    horizontal.addColorStop(0.92, "#fff");
    horizontal.addColorStop(1, "#000");
    context.fillStyle = horizontal;
    context.fillRect(0, 0, 128, 64);
    context.globalCompositeOperation = "multiply";
    const vertical = context.createLinearGradient(0, 0, 0, 64);
    vertical.addColorStop(0, "#000");
    vertical.addColorStop(0.12, "#fff");
    vertical.addColorStop(1, "#fff");
    context.fillStyle = vertical;
    context.fillRect(0, 0, 128, 64);
  }
  return new CanvasTexture(canvas);
}

function hash(index: number): number {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

// ---------------------------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------------------------

export class ReplayWorld {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(42, 16 / 9, 0.1, 400);
  private readonly sprite = starSprite();
  private readonly data: ReplayData;
  private readonly reducedMotion: boolean;

  private chapter: ChapterId = "sound";
  private chapterStarted = 0;
  private flight: { from: Shot; started: number; duration: number } | null = null;
  private readonly look = { position: new Vector3(0, 1.4, 9), target: new Vector3(0, 1, 0) };
  private noise = false;
  private noiseLevel = 0;
  private listenStarted: number | null = null;

  // Recording sky
  private readonly skyMaterial: ShaderMaterial;
  private readonly glowMaterial: MeshBasicMaterial;
  private readonly beam: Mesh;
  private readonly stars: StarField;
  private readonly starTimes: number[];
  private readonly starOrder: number[];
  private readonly waveform: Mesh;
  private readonly waveformMaterial: MeshBasicMaterial;
  private readonly noisePlane: Mesh;
  private readonly noiseTexture: CanvasTexture;
  private readonly noiseCanvas: HTMLCanvasElement;
  // Fingerprints
  private readonly pairStrokes = new Strokes(COLORS.lantern, 3.4, 1, 8);
  private readonly zoneStrokes = new Strokes(COLORS.lantern, 2.4, 0.85, 16);
  private readonly webStrokes = new Strokes(COLORS.lantern, 1.2, 0.22, 240);
  // Catalog
  private readonly galaxy = new Group();
  private readonly clusters: { songId: string; name: string; center: Vector3; field: StarField; hits: number; seeds: number[] }[] = [];
  private readonly streaks: StarField;
  private readonly streakPaths: { from: Vector3; to: Vector3; delay: number }[] = [];
  // Song sky and musubi
  private readonly songGroup = new Group();
  private readonly songStars: StarField;
  private readonly threads = new Strokes(COLORS.thread, 3.2, 1, MAX_THREADS * 6 + 12);
  private readonly knots: StarField;
  private readonly threadPairs: { query: Vector3; song: Vector3 }[] = [];
  private readonly pillars = new Group();
  private readonly pillarMeshes: { mesh: Mesh; height: number; winning: boolean }[] = [];
  // Edits and covers
  private readonly curveStrokes = new Strokes(COLORS.comet, 2.6, 1, 96);
  private readonly curveCursor = new Strokes(COLORS.lantern, 2, 1, 4);
  private readonly voiceGroup = new Group();
  private mixPlane: Mesh | null = null;
  private vocalPlane: Mesh | null = null;
  private readonly contourQuery = new Strokes(COLORS.lantern, 3, 1, 600);
  private readonly contourSong = new Strokes(COLORS.comet, 3, 1, 1200);
  private readonly dtwThreads = new Strokes(COLORS.thread, 1.6, 0.8, 300);

  constructor(canvas: HTMLCanvasElement, data: ReplayData, reducedMotion: boolean) {
    this.data = data;
    this.reducedMotion = reducedMotion;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.copy(this.look.position);
    this.camera.lookAt(this.look.target);

    // --- The recording's sky: a painted plane with a soft glow plane behind it.
    const skyTexture = new CanvasTexture(data.sky);
    skyTexture.minFilter = LinearFilter;
    skyTexture.colorSpace = SRGBColorSpace;
    this.skyMaterial = new ShaderMaterial({
      uniforms: {
        uMap: { value: skyTexture },
        uReveal: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uReveal; uniform float uOpacity; varying vec2 vUv;
        void main(){ vec4 c = texture2D(uMap, vUv); float edge = smoothstep(uReveal, uReveal - 0.012, vUv.x);
        float feather = smoothstep(0.0, 0.035, vUv.x) * smoothstep(1.0, 0.965, vUv.x) * smoothstep(1.0, 0.94, vUv.y);
        gl_FragColor = vec4(c.rgb, c.a * edge * feather * uOpacity); }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const skyPlane = new Mesh(new PlaneGeometry(SKY_WIDTH, SKY_HEIGHT), this.skyMaterial);
    skyPlane.position.set(0, SKY_BASE + SKY_HEIGHT / 2, 0);
    this.scene.add(skyPlane);
    const glowTexture = new CanvasTexture(data.skyGlow);
    glowTexture.colorSpace = SRGBColorSpace;
    this.glowMaterial = new MeshBasicMaterial({
      map: glowTexture,
      alphaMap: featherTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const glowPlane = new Mesh(new PlaneGeometry(SKY_WIDTH * 1.02, SKY_HEIGHT * 1.04), this.glowMaterial);
    glowPlane.position.set(0, SKY_BASE + SKY_HEIGHT / 2, -0.35);
    this.scene.add(glowPlane);

    // The spectrum beam: the analysis window sweeping through time.
    this.beam = new Mesh(
      new PlaneGeometry(0.08, SKY_HEIGHT),
      new MeshBasicMaterial({ color: COLORS.lantern, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    this.beam.position.set(0, SKY_BASE + SKY_HEIGHT / 2, 0.05);
    this.scene.add(this.beam);

    // Fog of noise for the robustness demonstration.
    this.noiseCanvas = document.createElement("canvas");
    this.noiseCanvas.width = 256;
    this.noiseCanvas.height = 112;
    this.noiseTexture = new CanvasTexture(this.noiseCanvas);
    this.noisePlane = new Mesh(
      new PlaneGeometry(SKY_WIDTH, SKY_HEIGHT),
      new MeshBasicMaterial({ map: this.noiseTexture, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    this.noisePlane.position.set(0, SKY_BASE + SKY_HEIGHT / 2, 0.12);
    this.scene.add(this.noisePlane);

    // --- Stars: every peak the server kept, louder ones slightly nearer.
    const peaks = data.response.explanation.peaks;
    const loudest = Math.max(...peaks.map((peak) => peak.amplitudeDb), -1);
    const quietest = Math.min(...peaks.map((peak) => peak.amplitudeDb), loudest - 1);
    this.stars = new StarField(peaks.length, this.sprite, 200);
    this.starTimes = peaks.map((peak) => peak.timeSeconds);
    peaks.forEach((peak, index) => {
      const level = (peak.amplitudeDb - quietest) / Math.max(1, loudest - quietest);
      const depth = (hash(index) - 0.5) * 1.4 + level * 0.6;
      this.stars.set(index, [this.x(peak.timeSeconds), this.y(peak.frequencyHz), depth], 0.9 + level * 1.5, COLORS.star, 0);
    });
    this.starOrder = peaks.map((_, index) => index).sort((a, b) => this.starTimes[a] - this.starTimes[b]);
    this.scene.add(this.stars.object);

    // --- The waveform as a ribbon lying on the lake, growing toward the viewer.
    const envelope = data.response.explanation.waveformEnvelope;
    const ribbon = new BufferGeometry();
    const vertices = new Float32Array(Math.max(1, envelope.length) * 6);
    envelope.forEach((point, index) => {
      const x = this.x(point.timeSeconds);
      // Built standing (x = time, y = amplitude); the spectrum stop lays it down onto the lake.
      vertices.set([x, point.maximum * 1.8, 0, x, point.minimum * 1.8, 0], index * 6);
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

    // --- Fingerprint strokes.
    this.scene.add(this.pairStrokes.object, this.zoneStrokes.object, this.webStrokes.object);

    // --- The catalog galaxy: one constellation per song, sized by its fingerprints.
    const songs = data.evidence?.songs ?? [];
    const maxPrints = Math.max(1, ...songs.map((song) => song.fingerprints));
    const clusterPoints = songs.map((song) => Math.round(40 + 110 * Math.log10(1 + song.fingerprints) / Math.log10(1 + maxPrints)));
    const totalPoints = clusterPoints.reduce((sum, value) => sum + value, 0);
    const clusterField = new StarField(Math.max(1, totalPoints), this.sprite, 520);
    let cursor = 0;
    songs.forEach((song, index) => {
      const angle = index * 2.39996 + 0.6;
      const radius = 11 + index * 0.95;
      const center = new Vector3(Math.cos(angle) * radius, 3 + Math.sin(index * 1.7) * 4, -30 + Math.sin(angle) * radius * 0.7);
      const seeds: number[] = [];
      for (let point = 0; point < clusterPoints[index]; point += 1) {
        const spread = 1.6;
        const offset = new Vector3(
          (hash(cursor * 3.1) - 0.5) * spread * 2,
          (hash(cursor * 5.7) - 0.5) * spread,
          (hash(cursor * 9.3) - 0.5) * spread * 2,
        );
        const winner = song.songId === data.response.recognition.song?.id;
        clusterField.set(cursor, center.clone().add(offset), 0.8 + hash(cursor) * 1.4, winner ? COLORS.comet : COLORS.star, 0);
        seeds.push(cursor);
        cursor += 1;
      }
      this.clusters.push({ songId: song.songId, name: song.name, center, field: clusterField, hits: song.hashHits, seeds });
    });
    this.galaxy.add(clusterField.object);
    this.scene.add(this.galaxy);

    // Shooting stars: one per lookup hit, capped, split by how many hits each song received.
    const totalHits = songs.reduce((sum, song) => sum + song.hashHits, 0);
    const budget = Math.min(420, totalHits);
    this.streaks = new StarField(Math.max(1, budget), this.sprite, 420);
    let streak = 0;
    for (const cluster of this.clusters) {
      const share = totalHits > 0 ? Math.round((cluster.hits / totalHits) * budget) : 0;
      for (let item = 0; item < share && streak < budget; item += 1) {
        const origin = this.stars.count > 0 ? this.stars.position(Math.floor(hash(streak * 7.7) * this.stars.count)) : new Vector3();
        this.streakPaths.push({ from: origin, to: cluster.center, delay: hash(streak * 3.3) * 4.2 });
        this.streaks.set(streak, origin, 1.1, COLORS.lantern, 0);
        streak += 1;
      }
    }
    this.scene.add(this.streaks.object);

    // --- The song's own sky, which will slide onto the recording's.
    const songPeaks = data.songStars;
    this.songStars = new StarField(Math.max(1, songPeaks.length), this.sprite, 200);
    songPeaks.forEach((peak, index) => {
      const level = clamp01((peak.amplitudeDb + 60) / 60);
      this.songStars.set(
        index,
        [this.x(peak.timeSeconds), this.y(peak.frequencyHz * data.pitchFactor), (hash(index + 99) - 0.5) * 1.2],
        0.8 + level * 1.3,
        COLORS.comet,
        0,
      );
    });
    this.songGroup.add(this.songStars.object);
    this.scene.add(this.songGroup);

    // Threads: each matched fingerprint ties a recording star to its twin in the song.
    const songStart = data.evidence?.songSky?.startSeconds ?? data.response.recognition.timestampSeconds ?? 0;
    const matched = data.response.explanation.matchedFingerprints;
    const step = Math.max(1, Math.ceil(matched.length / MAX_THREADS));
    for (let index = 0; index < matched.length; index += step) {
      const fingerprint = matched[index];
      const queryTime = fingerprint.queryAnchorSeconds;
      const songTime = (fingerprint.sourceAnchorSeconds - songStart) / Math.max(data.speedFactor, 0.01);
      this.threadPairs.push({
        query: new Vector3(this.x(queryTime), this.y(fingerprint.anchorFrequencyHz), 0),
        song: new Vector3(this.x(songTime), this.y(fingerprint.anchorFrequencyHz), 0),
      });
    }
    this.knots = new StarField(Math.max(1, this.threadPairs.length), this.sprite, 200);
    this.threadPairs.forEach((pair, index) => this.knots.set(index, pair.query, 2.2, COLORS.thread, 0));
    this.scene.add(this.threads.object, this.knots.object);

    // Offset votes as pillars of light standing on the lake.
    const allVotes = data.response.explanation.decision.clusteredOffsetVotes;
    const votes = [...allVotes].sort((a, b) => b.count - a.count).slice(0, 48);
    if (votes.length > 0) {
      const leading = Math.max(...votes.map((vote) => vote.count));
      const first = Math.min(...votes.map((vote) => vote.offsetSeconds));
      const last = Math.max(...votes.map((vote) => vote.offsetSeconds));
      for (const vote of votes) {
        const height = Math.max(0.06, (vote.count / leading) * 4.4);
        const color = vote.winning ? COLORS.thread : COLORS.star;
        // A column of light: bright at the lake, fading toward its top.
        const material = new ShaderMaterial({
          uniforms: { uColor: { value: color }, uOpacity: { value: 0 } },
          vertexShader: "varying float vH; void main(){ vH = position.y + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
          fragmentShader: "uniform vec3 uColor; uniform float uOpacity; varying float vH; void main(){ gl_FragColor = vec4(uColor, uOpacity * (1.0 - vH * 0.85)); }",
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
        });
        const mesh = new Mesh(new BoxGeometry(vote.winning ? 0.12 : 0.035, 1, vote.winning ? 0.12 : 0.035), material);
        const position = last > first ? (vote.offsetSeconds - first) / (last - first) : 0.5;
        mesh.position.set(-SKY_WIDTH * 0.42 + position * SKY_WIDTH * 0.84, 0, 0.25);
        mesh.scale.y = 0.001;
        this.pillars.add(mesh);
        this.pillarMeshes.push({ mesh, height, winning: vote.winning });
      }
    }
    this.scene.add(this.pillars);

    // Edits: the speed/pitch search curve lies on the lake.
    this.scene.add(this.curveStrokes.object, this.curveCursor.object);

    // Covers: the separated voice and the two melody lines.
    const melody = data.evidence?.melody;
    if (melody) {
      const mix = this.imagePlane(melody.mixSpectrogram, [180, 150, 220]);
      const vocal = this.imagePlane(melody.vocalSpectrogram, [255, 205, 150]);
      mix.position.set(0, SKY_BASE + SKY_HEIGHT * 0.35, -0.4);
      vocal.position.set(0, SKY_BASE + SKY_HEIGHT * 0.35, -0.2);
      this.voiceGroup.add(mix, vocal);
      this.mixPlane = mix;
      this.vocalPlane = vocal;
    }
    this.voiceGroup.add(this.contourQuery.object, this.contourSong.object, this.dtwThreads.object);
    this.scene.add(this.voiceGroup);

    this.resize();
  }

  // --- Coordinates -----------------------------------------------------------------------------

  private x(seconds: number): number {
    return -SKY_WIDTH / 2 + (SKY_WIDTH * seconds) / Math.max(this.data.duration, 0.001);
  }

  private y(hz: number): number {
    const low = Math.log(MIN_FREQUENCY_HZ);
    const high = Math.log(MAX_FREQUENCY_HZ);
    const clamped = Math.min(MAX_FREQUENCY_HZ, Math.max(MIN_FREQUENCY_HZ, hz));
    return SKY_BASE + (SKY_HEIGHT * (Math.log(clamped) - low)) / (high - low);
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
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return new Mesh(
      new PlaneGeometry(SKY_WIDTH, SKY_HEIGHT * 0.62),
      new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
  }

  // --- Camera stops ---------------------------------------------------------------------------

  private shot(chapter: ChapterId, local: number): Shot {
    const drift = this.reducedMotion ? 0 : Math.sin(local * 0.25) * 0.25;
    const shot = (position: [number, number, number], target: [number, number, number]): Shot => ({
      position: new Vector3(...position),
      target: new Vector3(...target),
    });
    const wide = shot([drift, WIDE_HEIGHT, WIDE_DISTANCE], [drift, WIDE_HEIGHT, 0]);
    switch (chapter) {
      case "sound":
      case "spectrum":
      case "musubi":
      case "listen":
      case "warp":
      case "voice":
      case "speed":
      case "verdict":
        return wide;
      case "stars": {
        // Drift slowly through the sky, close enough for the stars to part as we pass.
        const pan = this.reducedMotion ? 0 : Math.sin(local * 0.12) * 2.2;
        return shot([pan - 1, 3.3, 10.5], [pan - 0.6, 3.1, 0]);
      }
      case "fingerprint": {
        const pair = this.currentPair(local);
        const anchor = pair ? new Vector3(this.x(pair.anchorSeconds), this.y(pair.anchorFrequencyHz), 0) : new Vector3(0, 3.5, 0);
        const focus = anchor.clone().add(new Vector3(0.9, 0, 0));
        return { position: focus.clone().add(new Vector3(drift * 0.4, -0.4, 6.4)), target: focus.clone().add(new Vector3(0, -0.9, 0)) };
      }
      case "catalog":
        return shot([drift * 6, 10, 60 - Math.min(local, 12) * 0.9], [0, 2.5, -22]);
      case "listen":
        return wide;
    }
  }

  private currentPair(local: number) {
    const pairs = this.data.response.explanation.pairExamples;
    if (pairs.length === 0) return null;
    return pairs[Math.min(pairs.length - 1, Math.floor(local / 3.2)) % pairs.length];
  }

  listenTime(): number {
    if (this.listenStarted === null) return 0;
    return Math.min(this.data.duration, (performance.now() - this.listenStarted) / 1000);
  }

  // --- Public controls -----------------------------------------------------------------------

  goTo(chapter: ChapterId) {
    this.flight = {
      from: { position: this.camera.position.clone(), target: this.look.target.clone() },
      started: performance.now(),
      duration: this.reducedMotion ? 1 : chapter === "catalog" || this.chapter === "catalog" ? 3200 : 2300,
    };
    this.chapter = chapter;
    this.chapterStarted = performance.now();
    this.listenStarted = null;
  }

  replayChapter() {
    this.chapterStarted = performance.now();
    if (this.chapter === "listen") this.listenStarted = performance.now();
  }

  setNoise(on: boolean) {
    this.noise = on;
  }

  startListening() {
    this.listenStarted = performance.now();
  }

  resize() {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
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
    this.animateChapter(local, labels);

    // Camera: fly to the stop, then follow it.
    const wanted = this.shot(this.chapter, Math.max(0, local));
    if (this.flight) {
      const progress = clamp01((now - this.flight.started) / this.flight.duration);
      const eased = easeInOut(progress);
      // Rise a little in the middle of long flights, like a crane move.
      const lift = Math.sin(Math.PI * eased) * (this.flight.duration > 3000 ? 6 : 1.2);
      this.camera.position.lerpVectors(this.flight.from.position, wanted.position, eased);
      this.camera.position.y += lift;
      this.look.target.lerpVectors(this.flight.from.target, wanted.target, eased);
      if (progress >= 1) this.flight = null;
    } else {
      this.camera.position.lerp(wanted.position, 0.05);
      this.look.target.lerp(wanted.target, 0.05);
    }
    this.camera.lookAt(this.look.target);
    this.renderer.render(this.scene, this.camera);

    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    return labels.map((label) => ({ ...label, x: label.x * width, y: label.y * height }));
  }

  private project(point: Vector3): { x: number; y: number; visible: boolean } {
    const projected = point.clone().project(this.camera);
    return {
      x: (projected.x + 1) / 2,
      y: (1 - projected.y) / 2,
      visible: projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1,
    };
  }

  private animateChapter(local: number, labels: WorldLabel[]) {
    const chapter = this.chapter;
    const t = this.reducedMotion ? 1e3 : local;
    const data = this.data;

    // Defaults each frame: what each stop shows is decided below.
    let skyOpacity = 0;
    let reveal = 1;
    let starLevel = 0;
    let revealStarsUntil = data.duration;
    let waveform = 0;
    let beam = 0;
    let galaxy = 0;
    let song = 0;
    let threads = 0;
    let pillars = 0;
    let voice = 0;

    switch (chapter) {
      case "sound":
        waveform = 0.85 * easeOut(t / 2.5);
        break;
      case "spectrum": {
        reveal = clamp01((t - 0.8) / 7);
        skyOpacity = 1;
        beam = reveal > 0 && reveal < 1 ? 0.8 : 0;
        waveform = 0.3;
        this.beam.position.x = -SKY_WIDTH / 2 + SKY_WIDTH * reveal;
        break;
      }
      case "stars":
        skyOpacity = 1 - 0.72 * easeOut(t / 2);
        starLevel = 1;
        revealStarsUntil = data.duration * clamp01((t - 0.6) / 4.5);
        break;
      case "fingerprint":
        skyOpacity = 0.3;
        starLevel = 0.55;
        break;
      case "catalog":
        skyOpacity = 0.35;
        starLevel = 0.8;
        galaxy = easeOut(t / 2.5);
        break;
      case "musubi":
        skyOpacity = 0.25;
        starLevel = 0.85;
        song = easeOut(t / 1.8);
        threads = clamp01((t - 1) / 1.5);
        pillars = clamp01((t - 8.8) / 1.2);
        galaxy = Math.max(0, 1 - t / 1.5) * 0.6;
        break;
      case "warp":
        skyOpacity = 0.15;
        starLevel = 1;
        song = 1;
        break;
      case "voice":
        skyOpacity = 0.05;
        starLevel = 0.15;
        voice = 1;
        break;
      case "listen":
        skyOpacity = 0.35;
        starLevel = 0.5;
        break;
      case "speed":
        skyOpacity = 0.3;
        starLevel = 0.45;
        break;
      case "verdict":
        skyOpacity = 0.5;
        starLevel = 0.9;
        break;
    }

    // Sky paint and glow ease toward their targets.
    const sky = this.skyMaterial.uniforms;
    sky.uOpacity.value += (skyOpacity - sky.uOpacity.value) * 0.08;
    sky.uReveal.value = chapter === "spectrum" ? reveal : chapter === "sound" ? 0 : 1.02;
    this.glowMaterial.opacity += (skyOpacity * 0.7 - this.glowMaterial.opacity) * 0.08;
    const beamMaterial = this.beam.material as MeshBasicMaterial;
    beamMaterial.opacity += (beam - beamMaterial.opacity) * 0.2;
    this.waveformMaterial.opacity += (waveform - this.waveformMaterial.opacity) * 0.08;
    // Standing as a wave in the sky for "sound"; lying on the lake from "spectrum" on.
    const lay = chapter === "sound" ? 0 : chapter === "spectrum" ? easeInOut(t / 1.8) : 1;
    this.waveform.rotation.x = (-Math.PI / 2) * lay;
    this.waveform.position.set(0, SKY_BASE + SKY_HEIGHT * 0.3 * (1 - lay) + 0.02 * lay, 1.3 * lay);
    this.waveform.geometry.setDrawRange(0, chapter === "sound" ? Math.floor(clamp01(t / 3.5) * (this.waveform.geometry.index?.count ?? 0) / 6) * 6 : Infinity);

    // Noise fog: a live, shimmering haze that brightens everything except the peaks.
    const noiseMaterial = this.noisePlane.material as MeshBasicMaterial;
    this.noiseLevel += ((chapter === "stars" && this.noise ? 1 : 0) - this.noiseLevel) * 0.08;
    noiseMaterial.opacity = this.noiseLevel * 0.55;
    if (this.noiseLevel > 0.01) this.paintNoise();

    // Stars.
    for (const index of this.starOrder) {
      const appear = this.starTimes[index] <= revealStarsUntil ? 1 : 0;
      const matched = data.response.explanation.peaks[index].matched;
      const glow = chapter === "listen" ? this.listenGlow(index) : 0;
      const musubiTint = chapter === "musubi" && matched ? 1 : 0;
      this.stars.alpha(index, starLevel * appear * (musubiTint ? 1 : chapter === "musubi" ? 0.45 : 1) + glow);
    }
    this.stars.commit();

    // Fingerprint chapter: an anchor, its target zone, and the pair it makes.
    if (chapter === "fingerprint") {
      const pair = this.currentPair(t);
      if (pair) {
        const anchor = new Vector3(this.x(pair.anchorSeconds), this.y(pair.anchorFrequencyHz), 0.02);
        const target = new Vector3(this.x(pair.targetSeconds), this.y(pair.targetFrequencyHz), 0.02);
        const config = data.response.explanation.signalConfig;
        const frameSeconds = config.hopLength / data.sampleRate;
        const binHz = data.sampleRate / config.fftSize;
        const zoneLeft = this.x(pair.anchorSeconds + frameSeconds);
        const zoneRight = this.x(pair.anchorSeconds + 64 * frameSeconds);
        const zoneTop = this.y(pair.anchorFrequencyHz + 150 * binHz);
        const zoneBottom = this.y(Math.max(MIN_FREQUENCY_HZ, pair.anchorFrequencyHz - 150 * binHz));
        const zoneReveal = easeOut(((t % 3.2) - 0.2) / 0.8);
        const right = zoneLeft + (zoneRight - zoneLeft) * zoneReveal;
        const armX = (right - zoneLeft) * 0.18;
        const armY = (zoneTop - zoneBottom) * 0.22;
        this.zoneStrokes.set(zoneReveal <= 0 ? [] : [
          zoneLeft, zoneBottom, 0, zoneLeft + armX, zoneBottom, 0, zoneLeft, zoneBottom, 0, zoneLeft, zoneBottom + armY, 0,
          zoneLeft, zoneTop, 0, zoneLeft + armX, zoneTop, 0, zoneLeft, zoneTop, 0, zoneLeft, zoneTop - armY, 0,
          right, zoneBottom, 0, right - armX, zoneBottom, 0, right, zoneBottom, 0, right, zoneBottom + armY, 0,
          right, zoneTop, 0, right - armX, zoneTop, 0, right, zoneTop, 0, right, zoneTop - armY, 0,
        ]);
        const draw = easeOut(((t % 3.2) - 0.9) / 0.9);
        this.pairStrokes.set(draw > 0 ? [anchor.x, anchor.y, anchor.z, anchor.x + (target.x - anchor.x) * draw, anchor.y + (target.y - anchor.y) * draw, 0.02] : []);
        const screen = this.project(anchor);
        labels.push({
          id: "hash",
          text: `${Math.round(pair.anchorFrequencyHz)} Hz → ${Math.round(pair.targetFrequencyHz)} Hz, ${(pair.deltaFrames * frameSeconds).toFixed(2)} s apart`,
          detail: "hashed together into one 64-bit fingerprint",
          tone: "lantern",
          x: screen.x,
          y: screen.y,
          visible: screen.visible && draw > 0.6,
        });
      }
      const web: number[] = [];
      if (t > 3) {
        for (const fingerprint of data.response.explanation.matchedFingerprints.slice(0, 220)) {
          web.push(
            this.x(fingerprint.queryAnchorSeconds), this.y(fingerprint.anchorFrequencyHz), 0,
            this.x(fingerprint.queryTargetSeconds), this.y(fingerprint.targetFrequencyHz), 0,
          );
        }
      }
      this.webStrokes.set(web);
      this.webStrokes.material.opacity = 0.22 * clamp01((t - 3) / 2);
    } else {
      this.zoneStrokes.set([]);
      this.pairStrokes.set([]);
      this.webStrokes.set([]);
    }

    // Catalog galaxy and the lookup's shooting stars.
    for (const cluster of this.clusters) {
      const received = this.streakPaths.length > 0 ? cluster.hits : 0;
      const heat = chapter === "catalog" ? clamp01((t - 2) / 4) : chapter === "musubi" ? 1 : 0;
      const winner = cluster.songId === data.response.recognition.song?.id;
      for (const seed of cluster.seeds) {
        cluster.field.alpha(seed, galaxy * (0.3 + 0.7 * heat * Math.min(1, received / 400)) * (winner ? 1.3 : 0.85));
      }
      const screen = this.project(cluster.center.clone().add(new Vector3(0, 2.2, 0)));
      const top = [...this.clusters].sort((a, b) => b.hits - a.hits).slice(0, 5);
      if (chapter === "catalog" && (top.includes(cluster) || winner)) {
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
    if (this.clusters.length > 0) {
      this.clusters[0].field.commit();
    }
    this.streakPaths.forEach((path, index) => {
      // Lookups stream continuously while the camera is out among the songs.
      const cycle = ((t - 1.5 - path.delay) % 5.5 + 5.5) % 5.5;
      const progress = chapter === "catalog" && t > 1.5 + path.delay ? clamp01(cycle / 1.4) : 0;
      const head = path.from.clone().lerp(path.to, easeInOut(progress));
      head.y += Math.sin(Math.PI * progress) * 3;
      this.streaks.move(index, head.x, head.y, head.z);
      this.streaks.alpha(index, progress > 0 && progress < 1 ? 1 : 0);
    });
    this.streaks.commit(true);

    // The song's sky flies in from its constellation, then slides until every thread pulls taut.
    const winnerCluster = this.clusters.find((cluster) => cluster.songId === data.response.recognition.song?.id);
    if (chapter === "musubi" || chapter === "warp") {
      const arrive = chapter === "musubi" ? easeInOut(t / 2.2) : 1;
      const slide = chapter === "musubi" ? easeInOut((t - 2.4) / 3.6) : 1;
      const offset = (1 - slide) * 3.4;
      const origin = winnerCluster?.center ?? new Vector3(0, 6, -40);
      const home = new Vector3(offset, 0, -0.08 - (1 - slide) * 1.4);
      this.songGroup.position.lerpVectors(origin.clone().sub(new Vector3(0, SKY_BASE + SKY_HEIGHT / 2, 0)), home, arrive);
      this.songGroup.scale.setScalar(0.12 + 0.88 * arrive);
    }
    for (let index = 0; index < this.songStars.count; index += 1) this.songStars.alpha(index, song * 0.9);
    this.songStars.commit();

    const threadSegments: number[] = [];
    this.threadPairs.forEach((pair, index) => {
      const knot = chapter === "musubi" && t > 6.1 ? easeOut((t - 6.1) / 0.8) : 0;
      if (threads > 0.01) {
        const songPoint = pair.song.clone().multiplyScalar(this.songGroup.scale.x).add(this.songGroup.position);
        const reach = easeOut(clamp01((t - 1 - (index % 12) * 0.05) / 1.2));
        const end = pair.query.clone().lerp(songPoint, reach);
        const sag = Math.min(0.9, songPoint.distanceTo(pair.query) * 0.18);
        pushCurve(threadSegments, pair.query, end, sag, 6);
      }
      this.knots.alpha(index, knot * (1 + Math.sin(t * 6 + index) * 0.2));
      this.knots.size(index, 2.4 + knot * 1.4);
    });
    this.threads.set(chapter === "musubi" ? threadSegments : []);
    this.threads.material.opacity = chapter === "musubi" ? threads * (t > 7 ? 0.35 : 1) : 0;
    this.knots.commit();

    // Offset votes: pillars rise from the lake; only the true offset stands tall.
    this.pillarMeshes.forEach(({ mesh, height, winning }, index) => {
      const grow = easeOut((pillars * 1.6) - index * 0.004);
      mesh.scale.y = Math.max(0.001, height * grow);
      mesh.position.y = mesh.scale.y / 2;
      (mesh.material as ShaderMaterial).uniforms.uOpacity.value = pillars * (winning ? 1 : 0.55);
    });
    if (chapter === "musubi") {
      const decision = data.response.explanation.decision;
      const winning = this.pillarMeshes.find((pillar) => pillar.winning);
      if (winning && pillars > 0.5) {
        const screen = this.project(new Vector3(winning.mesh.position.x, winning.mesh.scale.y + 0.4, winning.mesh.position.z));
        labels.push({
          id: "pillar",
          text: `${decision.leadingVotes} fingerprints agree`,
          detail: `the next best position has ${decision.runnerUpVotes}`,
          tone: "thread",
          x: screen.x,
          y: screen.y,
          visible: screen.visible,
        });
      }
    }

    // Edits: re-hash under each speed guess; the stars stretch until they meet the song's.
    if (chapter === "warp" && data.evidence?.speedCurve) {
      const curve = data.evidence.speedCurve.filter((point) => point.pitchFactor === point.speedFactor);
      const sweep = easeInOut(clamp01((t - 0.8) / 6));
      const found = data.speedFactor;
      const lowest = curve[0]?.speedFactor ?? 0.75;
      const highest = curve[curve.length - 1]?.speedFactor ?? 1.35;
      const guess = t < 7 ? lowest + (highest - lowest) * sweep : found;
      const settle = t < 7 ? 0 : easeOut((t - 7) / 1.2);
      const factor = t < 7 ? guess : guess + (found - guess) * settle;
      // Place recording stars on the song grid under this guess: time × factor, pitch ÷ factor.
      this.data.response.explanation.peaks.forEach((peak, index) => {
        const position = this.stars.position(index);
        this.stars.move(index, this.x(peak.timeSeconds * factor / found), this.y(peak.frequencyHz / factor * found), position.z);
      });
      this.stars.commit(true);
      const maxVotes = Math.max(1, ...curve.map((point) => point.votes));
      const curveX = (value: number) => -0.4 + ((value - lowest) / (highest - lowest)) * (SKY_WIDTH / 2 - 0.2);
      const curveY = (votes: number) => SKY_BASE + 0.12 + (votes / maxVotes) * 2.6;
      const segments: number[] = [];
      curve.forEach((point, index) => {
        if (index === 0) return;
        const previous = curve[index - 1];
        segments.push(curveX(previous.speedFactor), curveY(previous.votes), 0.3, curveX(point.speedFactor), curveY(point.votes), 0.3);
      });
      this.curveStrokes.set(segments);
      const cursorX = curveX(factor);
      this.curveCursor.set([cursorX, SKY_BASE, 0.3, cursorX, SKY_BASE + 2.9, 0.3]);
      const screen = this.project(new Vector3(cursorX, SKY_BASE + 3.2, 0.3));
      labels.push({
        id: "speed",
        text: `${factor.toFixed(2)}×`,
        detail: t >= 7 ? `${Math.round(found * 100)}% speed: the stars line up` : "trying speeds…",
        tone: t >= 7 ? "comet" : "lantern",
        x: screen.x,
        y: screen.y,
        visible: screen.visible,
      });
    } else {
      this.curveStrokes.set([]);
      this.curveCursor.set([]);
      if (chapter !== "warp") this.restoreStars();
    }

    // Covers: the voice lifts out of the band, then two melody lines meet.
    const melody = data.evidence?.melody;
    const mix = this.mixPlane;
    const vocal = this.vocalPlane;
    if (mix && vocal) {
      const separate = chapter === "voice" ? easeInOut((t - 1) / 2.4) : 0;
      (mix.material as MeshBasicMaterial).opacity = voice * (1 - 0.6 * separate) * (t < 6 ? 1 : Math.max(0.15, 1 - (t - 6) / 1.5));
      (vocal.material as MeshBasicMaterial).opacity = voice * (0.2 + 0.8 * separate) * (t < 6 ? 1 : Math.max(0.2, 1 - (t - 6) / 1.5));
      vocal.position.y = SKY_BASE + SKY_HEIGHT * 0.35 + separate * 2.6;
      vocal.position.z = -0.2 + separate * 1.2;
    }
    if (melody && chapter === "voice" && t > 6) {
      const draw = clamp01((t - 6) / 2.5);
      // A robust pitch range: octave slips in the pitch track should not flatten everything else.
      const sorted = [...melody.song, ...melody.queryShifted].sort((a, b) => a - b);
      const low = sorted[Math.floor(sorted.length * 0.05)] ?? 48;
      const high = sorted[Math.floor(sorted.length * 0.95)] ?? 72;
      const span = Math.max(4, high - low);
      const pitchY = (midi: number) =>
        SKY_BASE + 1.4 + (Math.min(high + 2, Math.max(low - 2, midi)) - low) / span * (SKY_HEIGHT - 2.8);
      const slide = easeInOut((t - 9) / 1.6);
      const qx = (index: number) => -SKY_WIDTH * 0.42 + (index / Math.max(1, melody.query.length - 1)) * SKY_WIDTH * 0.84;
      // The original's notes are placed where the warping path says they meet the singer's,
      // so each thread ties two notes sung at the same moment of the tune.
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
        queryLine.push(qx(index - 1), queryHeight(index - 1), 0.4, qx(index), queryHeight(index), 0.4);
      }
      const songLine: number[] = [];
      const songShown = Math.floor(songIndices.length * draw);
      for (let index = 1; index < songShown; index += 1) {
        const a = songIndices[index - 1];
        const b = songIndices[index];
        if (a >= melody.song.length || b >= melody.song.length) continue;
        songLine.push(sx(a), pitchY(melody.song[a]), 0.3, sx(b), pitchY(melody.song[b]), 0.3);
      }
      this.contourQuery.set(queryLine);
      this.contourSong.set(songLine);
      const tie = clamp01((t - 11) / 1.5);
      const dtw: number[] = [];
      if (tie > 0) {
        melody.path.slice(0, Math.floor(melody.path.length * tie)).forEach(([queryIndex, songIndex], index) => {
          if (index % 2 === 1 || queryIndex >= melody.query.length || songIndex >= melody.song.length) return;
          dtw.push(qx(queryIndex), queryHeight(queryIndex), 0.4, sx(songIndex), pitchY(melody.song[songIndex]), 0.3);
        });
      }
      this.dtwThreads.set(dtw);
      if (slide > 0.9) {
        const screen = this.project(new Vector3(qx(0), pitchY(high) + 0.6, 0.4));
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
    } else {
      this.contourQuery.set([]);
      this.contourSong.set([]);
      this.dtwThreads.set([]);
    }
  }

  private restoreStars() {
    const peaks = this.data.response.explanation.peaks;
    let moved = false;
    peaks.forEach((peak, index) => {
      const position = this.stars.position(index);
      const x = this.x(peak.timeSeconds);
      const y = this.y(peak.frequencyHz);
      if (Math.abs(position.x - x) > 1e-4 || Math.abs(position.y - y) > 1e-4) {
        this.stars.move(index, position.x + (x - position.x) * 0.15, position.y + (y - position.y) * 0.15, position.z);
        moved = true;
      }
    });
    if (moved) this.stars.commit(true);
  }

  private listenGlow(index: number): number {
    if (this.listenStarted === null) return 0;
    const since = this.listenTime() - this.starTimes[index];
    return since >= 0 && since < 0.35 ? 1.4 * (1 - since / 0.35) : 0;
  }

  private paintNoise() {
    const context = this.noiseCanvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(this.noiseCanvas.width, this.noiseCanvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = Math.random();
      image.data[index] = 200;
      image.data[index + 1] = 170;
      image.data[index + 2] = 235;
      image.data[index + 3] = Math.round(value * value * 150);
    }
    context.putImageData(image, 0, 0);
    this.noiseTexture.needsUpdate = true;
  }

  dispose() {
    this.stars.dispose();
    this.streaks.dispose();
    this.songStars.dispose();
    this.knots.dispose();
    this.clusters[0]?.field.dispose();
    for (const strokes of [this.pairStrokes, this.zoneStrokes, this.webStrokes, this.threads, this.curveStrokes, this.curveCursor, this.contourQuery, this.contourSong, this.dtwThreads]) {
      strokes.dispose();
    }
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const material = object.material as MeshBasicMaterial | ShaderMaterial;
        if ("map" in material && material.map) material.map.dispose();
        material.dispose();
      }
    });
    this.sprite.dispose();
    this.renderer.dispose();
  }
}
