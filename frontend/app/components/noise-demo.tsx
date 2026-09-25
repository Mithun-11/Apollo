"use client";

import { useMemo, useState } from "react";
import type { PeakDisplay } from "../../lib/api";

export default function NoiseDemo({ peaks, duration, maximumFrequency }: { peaks: PeakDisplay[]; duration: number; maximumFrequency: number }) {
  const [noise, setNoise] = useState(0);
  const originals = useMemo(() => peaks.slice(0, 50), [peaks]);
  const added = useMemo(() => Array.from({ length: noise }, (_, index) => ({
    timeSeconds: ((index * 73 + 17) % 101) / 101 * duration,
    frequencyHz: ((index * 47 + 11) % 103) / 103 * maximumFrequency,
    amplitudeDb: -75 + (index * 19 % 65),
  })), [noise, duration, maximumFrequency]);
  const ranked = [...originals.map((peak, index) => ({ ...peak, original: index })), ...added.map((peak) => ({ ...peak, original: -1 }))].sort((a, b) => b.amplitudeDb - a.amplitudeDb).slice(0, 50);
  const retained = ranked.filter((peak) => peak.original >= 0).length;
  return <div className="lab-tool"><h3>Noise robustness demonstration</h3><p>Add synthetic spectral dots to a bounded sample of real query peaks. The illustration shows how stronger landmarks can remain among the top 50 candidates.</p><label className="noise-control">Added noise peaks <input type="range" min="0" max="100" value={noise} onChange={(event) => setNoise(Number(event.target.value))} />{noise}</label><svg className="noise-plot" viewBox="0 0 620 250" role="img" aria-label={`${retained} of ${originals.length} sampled original peaks remain in the top 50 after adding ${noise} synthetic noise peaks`}><rect width="620" height="250" rx="12" fill="#10242b" />{added.map((peak, index) => <circle key={`n-${index}`} cx={20 + peak.timeSeconds / Math.max(duration, 1) * 580} cy={230 - peak.frequencyHz / Math.max(maximumFrequency, 1) * 210} r="2" fill="#788b99" />)}{originals.map((peak, index) => <circle key={`p-${index}`} cx={20 + peak.timeSeconds / Math.max(duration, 1) * 580} cy={230 - peak.frequencyHz / Math.max(maximumFrequency, 1) * 210} r={ranked.some((item) => item.original === index) ? 4 : 2} fill={peak.matched ? "#efbd78" : "#8edbd8"} opacity={ranked.some((item) => item.original === index) ? 1 : .35} />)}</svg><p className="lab-caption">{retained} of {originals.length} sampled original peaks remain in the illustrative top-50 selection. Gray dots are synthetic noise; gold dots contributed to the original winning match. This does not recalculate fingerprints or predict recognition accuracy.</p></div>;
}
