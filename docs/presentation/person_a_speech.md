# Apollo presentation: Person A speech and cues

This follows the two-person **6-minute presentation and demonstration** plan in the supplied image. Person A owns shared slides **1, 2, 3, 4 and 6**, Demo 1, and Demo 2. Person B owns slide 5, the class-mode replay, slide 7, the cover demo and slide 8. Timings below are **wall-clock targets**, including switching screens. Rehearse with the actual projector and clips; speak naturally rather than reading every word.

The `.tex` deck contains only Person A's five slides. Before submission, replace `\TeamNames` with both presenters' real names and merge these frames into the shared deck in slide-number order. Slide 3 has **one click** to change the waveform view into the spectrogram view; this creates two PDF pages for one speaking segment. The other slides have no animation.

## 0:00–0:20 — Slide 1: Apollo / the problem

**Say (about 18 seconds):** “This is Apollo. We give it a short recording, and it tries to return two things: the song title and the moment where our clip begins in the original song. We also handle noisy clips, speed edits and some covers. I will start with an ordinary recording.”

**Do:** Trace the input-to-output line once. Move immediately to the app. Do not explain the algorithm yet.

## 0:20–0:45 — Demo 1: original recording

**Do:** In the already open Apollo tab, choose **Browser tab**, click **Listen**, choose the tab playing a known catalog song, and enable **Share tab audio**. Have the song tab and its playback point ready before the presentation. If tab capture is unavailable, use the tested microphone setup.

**Say while it listens:** “The browser is painting the sound as a sky: time moves across, frequency goes up, and bright stars mark strong local frequency spots. The answer comes from the server's fingerprint search, not from this drawing.”

**When the title appears:** “It found the title and the source moment. Let's see the path from audio to this answer.” Return to slide 2. If the title has not appeared by the 15-second limit, state that the live clip was not confirmed and continue; do not spend the entire presentation troubleshooting.

## 0:45–1:05 — Slide 2: architecture

**Say (about 19 seconds):** “Follow the arrows. The browser captures the microphone or a tab as a mono WAV clip. Next.js proxies the request to FastAPI, which validates the audio and calls our Python signal code. That code compares fingerprints through an indexed SQLite catalog. The result returns to the page as a song title and source time.”

**Point to:** The four dark boxes from left to right, then the green return arrow. Avoid explaining file names on screen; answer those in Q&A if asked.

## 1:05–1:40 — Slide 3: sampling and STFT

**Say (about 30 seconds):** “This first view is a real recording from Apollo. We make both the song and the query mono, normalize their peaks and resample to 22,050 samples per second, so they use the same frequency grid. [Click once.] Now you see the spectrogram for that recording. We split the wave into 2,048-sample windows, about 93 milliseconds, and move forward 512 samples each time. The STFT measures frequency strength in every window. Each window becomes one vertical column: time runs across, frequency runs up.”

**Point to:** The real waveform, then click to the real spectrogram. Trace one vertical column and then the time axis. The spectrum screenshot is cropped to the graph; its original side explanation is intentionally absent.

## 1:40–2:00 — Slide 4: peaks

**Say (about 17 seconds):** “This is the same recording with peaks over its spectrogram. Each dot is a strong frequency at one moment. Apollo keeps local maxima in 15-by-9 neighborhoods, between 100 hertz and 5 kilohertz, capped at 60 per second. Gold dots later supported the winning match.”

**Hand off to Person B:** “Now [teammate name] will show how pairs of landmarks become a match.” Person B begins shared slide 5 at **2:00**.

## 3:15–3:25 — Slide 6: speed search

**Come back after Person B's replay segment. Say (about 9 seconds):** “Speed edits change both pitch and timing; pitch-only edits change just pitch. We try 78 corrections on the detected peaks, then use our normal fingerprint matcher.”

**Do:** Point to the two table rows, then switch immediately to the edit demo.

## 3:25–4:05 — Demo 2: edited recording

**Do:** Return to Apollo, start a **pretested** slowed or sped-up clip that is in the catalog, click Listen, and share its audio tab. The plan's “slowed to 89%” line should be used only if your tested clip actually produces that result. Keep a backup known-good edit available.

**Say while the clip plays:** “The normal fingerprint check may miss this version because the frequency bins and time gaps have moved. Apollo scores 39 speed-plus-pitch factors and 39 pitch-only factors in a quick first pass, then checks the strongest guesses more carefully.”

**When the result appears:** “Here the answer reports the detected edit factor as well as the song and source time.” Point to the factor shown on your screen, using its actual value. Hand off: “Covers need a different method; [teammate name] will explain that.” Person B begins shared slide 7 at **4:05**.

## Rehearsal notes

- Start both servers and open the production page before the lab. Put the presentation file on the teacher's PC **before 2:30 PM**.
- Test browser-tab audio sharing, permission prompts, playback volume, projected text size, and the adapter you will use. Keep the playing song in a separate browser window so the Apollo tab stays responsive.
- Test the exact original and edit clips on this laptop. Do not quote the plan's “about 3 s” or “89%” as guaranteed results. The local catalog currently has **21 songs**; the theme HTML's “25 songs” is sample content, not this database.
- In the first demo, say “the browser paints a live view of strong frequency spots.” Its visual FFT is separate from the Python recognizer.
- Practice the Person A total: **1:45 of slides, 1:05 of demos = 2:50**, leaving the planned handoffs and Person B's part inside six minutes.
