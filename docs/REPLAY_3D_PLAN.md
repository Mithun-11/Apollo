# Replay 3D rebuild: plan

Status (2026-09-25): **All four phases are built and verified.** Nothing
is committed.

Decisions made:
- The lock plays the user's own recording; the matched song itself plays on Spotify.
- `postprocessing` 6.39.5 is the only new dependency.

Deviations found while building:
- **Bloom is threshold-based, not a selection list:** only the data is bright enough to bloom.
- **Multisampling is off:** it rendered black on this machine's GPU backend.
- **Colour space:** every custom shader converts its hand-written sRGB colours to linear, so the
  picture is the same with or without post-processing.
- **The lock's threads converge on the winning pillar,** the offset each matched fingerprint voted
  for, instead of tying star to star. At the snap the two stars coincide, so star-to-star threads
  had collapsed into spikes.
- **Beat logic stays in `world.ts` for now;** Phase 3 moves each beat into its own file under
  `world/`.

## 1. Checking the diagnosis against the code

All six points hold.

| Point | Evidence in the code |
|---|---|
| 1. The beauty lives outside 3D | `painted-sky.tsx` is a full-screen shader and `horizon.tsx` is SVG. The replay canvas is transparent and drawn *over* them (`world.ts:348`, `alpha: true`, clear colour 0). |
| 2. The camera is pinned face-on | `WIDE_DISTANCE`/`WIDE_HEIGHT` (`world.ts:73`). 7 of the 10 stops return the same `wide` shot (`world.ts:628-636`). |
| 3. Flat sheets | The spectrogram is one `PlaneGeometry` with a canvas texture (`world.ts:373`); the waveform is a flat ribbon. Stars sit within ±0.7 units of one plane. |
| 4. A slideshow | `goTo()` lerps between fixed shots, then holds (`world.ts:668`, `713-726`). |
| 5. Flat shading | Everything is `MeshBasicMaterial`/additive: nothing is lit, and nothing has volume. |
| 6. No depth cues | No fog, no parallax layers, no depth of field. Nothing passes the lens. The only depth is the catalog galaxy. |

**One more issue:** `page.tsx` imports `Replay` statically, so the whole replay module ships with the start screen. three.js itself is already on the start screen (the painted sky uses it); the replay code is not needed there.

## 2. Where I would change the brief

These are the "make it better" parts. Each has a reason.

1. **One new library, not four.** I would add only `postprocessing` (pmndrs, v6.39.5; supports three ≥ 0.168 < 0.187, and we pin 0.180). It merges bloom, depth of field, chromatic aberration, noise and vignette into a single full-screen pass, which is the fastest option on a 3050.
   - **No GSAP, Theatre.js or three.quarks.** The camera path uses three's own `CatmullRomCurve3`. The lock sequence is a small typed timeline (about 80 lines). Rain, meteors and shatter particles are written as GPU point shaders like the existing `StarField`.
   - **Why:** fewer downloads during "Preparing the replay…", no licence questions, no version drift. It follows the AGENTS rule "no dependencies as a side effect".
2. **The spectrogram terrain is built on the GPU.** The heights come from a `DataTexture` of the real spectrogram (256 time columns × 180 log-pitch rows, the same mapping as the live sky) and are displaced in the vertex shader. Then these are just uniforms, with no CPU rebuilds and no per-frame allocations:
   - the beam building it slice by slice;
   - the drawbridge tilt;
   - the accordion stretch of the speed search;
   - the jagged storm noise.
3. **The opening reveal hands off instead of matching pixels.** Making a 3D dome, ridges and poles reproduce the 2D painting pixel for pixel is fragile. Instead:
   - the first frame keeps the real 2D painted sky and horizon *behind* a transparent WebGL canvas, and the 3D spectrogram plane is placed exactly where the live sky was, as today;
   - when the drawbridge starts to tilt and the camera pulls back, the 3D dome and scenery fade in over about 1 s and the 2D layers fade out;
   - the camera move hides the swap, so it looks like one continuous picture.
4. **The water reflects only what matters.** Rendering the scene twice every frame is the single most expensive thing in the brief.
   - The lake uses three's `Reflector` at half resolution, drawing only the dome, ridges, stars, threads and pillars through a render layer. The terrain, clouds and particles are left out.
   - Shockwave rings and ripples are added in the water shader.
5. **"The real song plays from the matched second" needs a decision (see §8).** Playing the user's own recording at the lock costs nothing. Playing the catalog's clean studio version from the matched second is more magical, but needs a small new backend route.
6. **Adaptive quality is automatic and one-way.** A rolling 60-frame average steps down one level when it passes 22 ms: depth of field → god rays → reflection resolution → particle counts. It never steps back up mid-shot, so nothing flickers.
7. **The spline passes through each beat's data.** The camera path is built from this recording's data, not fixed coordinates. The fingerprint beat flies to the actual anchor star, and the climax pushes in on the actual winning pillar.

## 3. Rules I will not break

- **Recognition is not touched:** no changes to the backend matching, the recording logic in `page.tsx`, or `live-sky.tsx`.
- **The answer card is untouched,** so it still appears on the first confirmed live check.
- **Heavy work happens only after the replay is opened:** building the world, compiling shaders and loading audio. The replay module is loaded with a dynamic import.
- **Everything shown comes from this recording's data:** explanation + evidence.
- **Colours keep their meaning:** white = recording, teal = song, amber = analysis, red = match only.
- **Original art only,** built procedurally. No downloaded models.
- **Laptop and projector only.**
- **Nothing is committed** (the user said so; the phases below are stopping points, not commits).

## 4. Files

```text
frontend/app/page.tsx              only: the Replay import becomes next/dynamic (no logic change)
frontend/app/replay/
  replay.tsx          UI shell; keeps captions, figures, rail, keys; adds mute/volume, fps guard
  chapters.ts         unchanged content; beat ids and order stay
  data.ts             + spectrogram DataTexture source, full-rate waveform samples
  world.ts            REPLACED by a thin orchestrator (scene, renderer, loop, dispose)
  world/              new, one concern per file:
    scenery.ts          sky dome shader, ridges, hill, poles + catenary wires, fog
    clouds.ts           layered toon cloud billboards at many depths
    lake.ts             Reflector water + ripple/shockwave shader
    terrain.ts          spectrogram mountain range (GPU displaced), beam slab, storm noise
    stars.ts            StarField (moved from world.ts), ignite flashes, shock rings
    waveform.ts         3D ribbon/tube + shatter particles
    fingerprints.ts     anchor, 3D target-zone volume, light arcs
    galaxy.ts           catalog constellations, meteor storm (GPU particles with trails)
    alignment.ts        song constellation, threads, pillars, crumble, lock timeline
    edits.ts            accordion + 3D vote ridge (speed search)
    voice.ts            melody ribbons + DTW threads (covers)
    camera.ts           CatmullRom position + look-at paths, beat parameters, drift, shake
    timeline.ts         tiny keyframe/easing timeline for the lock sequence
    post.ts             postprocessing composer + adaptive quality
    audio.ts            Web Audio synthesis: whoosh, crackle, rain, thunder, riser, boom
    toon.ts             shared toon material (2–3 tones + rim), fog-aware
frontend/package.json            + postprocessing (only new dependency)
DESIGN.md                        updated at the end
```

`painted-sky.tsx`, `horizon.tsx` and `live-sky.tsx` stay as they are. They still draw the start and listening screens, and the replay's first frame.

## 5. Scene layout

All units in metres. The lake is y = 0, the camera looks toward −z.

```text
sky dome          radius 400, banded evening shader (our palette), stars in the upper band
far ridge         z ≈ −180, toon shaded, fog-faded      ┐
near hill         z ≈ −70                               │ parallax layers
poles + wires     x 20…60, z −8…−60, receding           │
clouds            ~40 billboards, z −15…−250, y 8…60     ┘ camera flies between them
spectrogram       x −8…8 (time), z 0…−10 (pitch), y 0…3 (loudness), standing on the lake
stars             on the summits (y = height + 0.15), real depth = pitch
galaxy            above the clouds: y 70…110, z −60…−200
fog               exponential, tinted to the horizon colour
```

## 6. Camera path (one unbroken flight)

- **Two curves:** a `CatmullRomCurve3` for the camera position and a second one for the look-at target, so the gaze leads into turns.
- **Beats:** each beat is a parameter on the path. Reaching one eases the speed down to a slow drift (about 0.4 m/s) with slight breathing; the camera never stops completely.
- **Class mode:** → ↓ PageDown glide to the next beat and ← ↑ PageUp to the previous one, with eased speed; the rail jumps there. Space replays the beat's own animation, N adds noise and Esc leaves, as today.
- **Highlight mode:** plays the whole path in one shot.

| Beat | Camera |
|---|---|
| Open | Face-on, framed exactly like the live sky |
| 音 Sound | Slow push toward the standing waveform ribbon |
| 空 Spectrum | Drawbridge: the plane tilts back onto the lake while the camera cranes up and back, a three-quarter reveal of the terrain |
| 星 Stars | Low sweep along the time axis, 0.5 m above the summits; stars pass close to the lens |
| 結 Fingerprints | Push-in to the real anchor star, shallow depth of field |
| 星空 Catalog | Rises vertically through the cloud layers into the galaxy |
| 速度 / 声 | Pull back to see the whole terrain stretch, or the ribbons |
| 結び Alignment | Descends with the teal constellation; slow push-in to the winning pillar; hard dolly and shake on the lock |
| 聴く Listen | Slow orbit around the terrain |
| Answer | Long pull-back to the whole world |

## 7. Phases (each ends with a working demo)

1. **The 3D world and the flight** (the biggest win):
   - sky dome, scenery, clouds, reflective lake, fog;
   - the spectrogram terrain, and stars at depth;
   - the spline camera and the drawbridge opening;
   - existing beat content ported onto the new world, so nothing is lost;
   - lazy loading.
2. **Post-processing and the Alignment climax:** selective bloom, depth of field, chromatic pulse, grain and vignette as effects; the full lock sequence (snap, threads fire, false pillars crumble into the lake, shockwave through water and clouds, shake, bloom surge, song plays, title card lands).
3. **Transformations between beats:** the waveform shatters into the spectrogram, fingerprint light arcs and a 3D target zone, the catalog meteor storm, the speed-search accordion with its 3D vote ridge, and the voice ribbons.
4. **The noise storm** (rain, wind, jagged terrain, lightning, stars that stay lit), **sound design** (synthesised, with mute and volume), and **polish**: reduced motion and the photosensitivity cap.

**After each phase:**
- lint, typecheck, build and backend tests;
- time the answer in a production build (it must stay within the `AGENTS.md` budgets);
- measure fps at 1920×1080 and 1366×768;
- screenshot every beat and check three questions: does it read as 3D, is there parallax, and is the data the brightest thing on screen?

## 8. Decisions I need from you

1. **The song at the lock:**
   - **(a)** play your own recording from its start (no backend change); or
   - **(b)** play the catalog's original from the matched second, through a new read-only route `GET /songs/{id}/clip?start=` that serves 8 s from the file in `Songs/`. It is fetched while the replay prepares and doesn't touch recognition.

   I recommend (b): it proves the match audibly.
2. **Adding `postprocessing`** as the only new dependency (about 2.7 MB unpacked; roughly 60–80 kB of it is used after tree-shaking).

## 9. Risks

- **Size:** this is several thousand lines of new rendering code. Phase 1 alone is the bulk. I'll keep each phase shippable so we can stop at any point.
- **Performance on the real laptop:** I can only measure here (RTX 4060-class machine plus headless Chrome). Adaptive quality covers the gap, but please run the fps overlay once on the demo laptop and projector.
- **Opening time:** building the terrain and compiling shaders adds work to "Preparing the replay…". I'll compile everything with `renderer.compileAsync` in parallel with the evidence request, so the total should stay close to today's (about 4 s normal, 7 s edit). I'll report the measured number.
- **Readability on a projector:** bloom and fog lower contrast. The white stars and red threads get their own bloom layer, and the scrims under the text stay.
- **Covers and edits** have extra beats that I can only test with the clips we have (Heat Waves, the F1 edit, the Purnota cover).
