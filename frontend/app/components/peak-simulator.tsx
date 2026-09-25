"use client";

import { useMemo, useState } from "react";
import type { RecognitionExplanation } from "../../lib/api";

const SIZE = 32;
const energy = Array.from({ length: SIZE }, (_, row) => Array.from({ length: SIZE }, (_, column) => {
  const background = -85 + ((row * 17 + column * 43 + row * column * 7) % 38);
  const landmark = (row === 5 && column === 8) || (row === 18 && column === 20) || (row === 27 && column === 28);
  return landmark ? -12 : background;
}));

export default function PeakSimulator({ config }: { config: RecognitionExplanation["signalConfig"] }) {
  const [frequencyWindow, setFrequencyWindow] = useState(15);
  const [timeWindow, setTimeWindow] = useState(9);
  const [floor, setFloor] = useState(config.peakFloorDb);
  const [budget, setBudget] = useState(config.peaksPerSecond);
  const peaks = useMemo(() => {
    const candidates: { row: number; column: number; value: number }[] = [];
    for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
      const value = energy[row][column];
      if (value < floor) continue;
      let highest = true;
      for (let r = Math.max(0, row - Math.floor(frequencyWindow / 2)); r <= Math.min(SIZE - 1, row + Math.floor(frequencyWindow / 2)); r++) {
        for (let c = Math.max(0, column - Math.floor(timeWindow / 2)); c <= Math.min(SIZE - 1, column + Math.floor(timeWindow / 2)); c++) {
          if (energy[r][c] > value || energy[r][c] === value && (r < row || r === row && c < column)) highest = false;
        }
      }
      if (highest) candidates.push({ row, column, value });
    }
    return new Set(candidates.sort((a, b) => b.value - a.value).slice(0, budget).map((peak) => `${peak.row}-${peak.column}`));
  }, [frequencyWindow, timeWindow, floor, budget]);
  return <div className="lab-tool"><h3>Peak detection simulator</h3><p>This synthetic 32×32 spectrogram uses local maxima, a level floor, and a peak budget. It illustrates Apollo&apos;s selection rules on a small grid.</p><div className="lab-controls"><label>Frequency neighborhood <input type="range" min="3" max="21" step="2" value={frequencyWindow} onChange={(event) => setFrequencyWindow(Number(event.target.value))} />{frequencyWindow} bins</label><label>Time neighborhood <input type="range" min="3" max="15" step="2" value={timeWindow} onChange={(event) => setTimeWindow(Number(event.target.value))} />{timeWindow} frames</label><label>Amplitude floor <input type="range" min="-85" max="-15" value={floor} onChange={(event) => setFloor(Number(event.target.value))} />{floor} dB</label><label>Peak budget <input type="range" min="1" max="60" value={budget} onChange={(event) => setBudget(Number(event.target.value))} />{budget}</label></div><div className="peak-grid" role="img" aria-label={`${peaks.size} selected local maxima in a synthetic spectrogram`}>{energy.map((row, r) => row.map((value, c) => <span key={`${r}-${c}`} className={peaks.has(`${r}-${c}`) ? "peak-cell peak-cell--selected" : "peak-cell"} style={{ opacity: peaks.has(`${r}-${c}`) ? 1 : Math.max(.14, (value + 90) / 80) }} title={`Bin ${r}, frame ${c}: ${value} dB`} />))}</div><p className="lab-caption">{peaks.size} peaks selected. Apollo defaults to a 15-bin × 9-frame neighborhood, {config.peakFloorDb} dB floor and {config.peaksPerSecond} peaks per second.</p></div>;
}
