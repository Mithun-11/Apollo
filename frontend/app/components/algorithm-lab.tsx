"use client";

import { lazy, Suspense, useState } from "react";
import type { RecognitionExplanation } from "../../lib/api";

const SpectrogramPlayground = lazy(() => import("./spectrogram-playground"));
const PeakSimulator = lazy(() => import("./peak-simulator"));
const HashExplainer = lazy(() => import("./hash-explainer"));
const VoteSimulator = lazy(() => import("./vote-simulator"));
const NoiseDemo = lazy(() => import("./noise-demo"));
const TOOLS = ["Spectrogram", "Peak detection", "Fingerprint inputs", "Offset voting", "Noise"] as const;

export default function AlgorithmLab({ explanation }: { explanation: RecognitionExplanation }) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <section className="algorithm-lab" aria-labelledby="lab-title">
      <p className="eyebrow">ALGORITHM LAB · INTERACTIVE DEMONSTRATIONS</p>
      <h2 id="lab-title">Experiment with the signal ideas.</h2>
      <p>These browser-only demonstrations do not rerun Apollo recognition or change your result.</p>
      <div className="lab-tabs" role="group" aria-label="Choose a signal demonstration">{TOOLS.map((tool, index) => <button type="button" key={tool} className={active === index ? "lab-tab lab-tab--active" : "lab-tab"} onClick={() => setActive(active === index ? null : index)} aria-pressed={active === index}>{tool}</button>)}</div>
      {active !== null && <Suspense fallback={<p className="lab-loading">Loading demonstration…</p>}><div className="lab-content">
        {active === 0 && <SpectrogramPlayground config={explanation.signalConfig} />}
        {active === 1 && <PeakSimulator config={explanation.signalConfig} />}
        {active === 2 && <HashExplainer explanation={explanation} />}
        {active === 3 && <VoteSimulator decision={explanation.decision} />}
        {active === 4 && <NoiseDemo peaks={explanation.peaks} duration={explanation.queryDurationSeconds} maximumFrequency={explanation.spectrogram.maximumFrequencyHz} />}
      </div></Suspense>}
    </section>
  );
}
