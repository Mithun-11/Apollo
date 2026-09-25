"use client";

import { useState } from "react";
import type { RecognitionExplanation } from "../../lib/api";

export default function HashExplainer({ explanation }: { explanation: RecognitionExplanation }) {
  const example = explanation.pairExamples[0];
  const toBin = (hz: number) => Math.round(hz * explanation.signalConfig.fftSize / explanation.sampleRate);
  const [anchor, setAnchor] = useState(example ? toBin(example.anchorFrequencyHz) : 50);
  const [target, setTarget] = useState(example ? toBin(example.targetFrequencyHz) : 90);
  const [frames, setFrames] = useState(example?.deltaFrames ?? 12);
  const input = `${explanation.signalConfig.fingerprintVersion}|${anchor}|${target}|${frames}`;
  return <div className="lab-tool"><h3>Fingerprint hash inputs</h3><p>Choose two frequency bins and their frame separation. Apollo hashes this exact versioned string using BLAKE2b with an 8-byte digest.</p><div className="lab-controls"><label>Anchor frequency bin <input type="range" min="1" max="400" value={anchor} onChange={(event) => setAnchor(Number(event.target.value))} />{anchor}</label><label>Target frequency bin <input type="range" min="1" max="400" value={target} onChange={(event) => setTarget(Number(event.target.value))} />{target}</label><label>Frame separation <input type="range" min="1" max="64" value={frames} onChange={(event) => setFrames(Number(event.target.value))} />{frames}</label></div><div className="hash-formula"><span>{anchor} anchor bin</span><b>+</b><span>{target} target bin</span><b>+</b><span>{frames} frames</span><b>→</b><code>BLAKE2b-64(&quot;{input}&quot;)</code></div><p className="lab-caption">Apollo stores the resulting 16-digit hexadecimal hash. This demo shows the exact input string; it does not invent or display a hash value. Changing any input changes what Apollo would hash.</p></div>;
}
