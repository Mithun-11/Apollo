/**
 * The land at dusk: a far ridge, a near hill, and a line of utility poles whose wires sag across
 * the sky. Drawn once as crisp vectors over the painted sky; the lake line sits at the horizon.
 */

import { HORIZON } from "./geometry";

const WIDTH = 1600;
const HEIGHT = 1000;
const HORIZON_Y = HEIGHT * HORIZON;

// Deterministic ridge lines so the landscape is identical on every load.
function ridge(seed: number, base: number, amplitude: number, detail: number, shore: number): string {
  const points: string[] = [];
  let value = 0;
  for (let x = 0; x <= WIDTH; x += 8) {
    const t = x / WIDTH;
    value =
      Math.sin(t * 6.1 + seed) * 0.5 +
      Math.sin(t * 13.7 + seed * 2.3) * 0.28 +
      Math.sin(t * 31.3 + seed * 4.1) * 0.12 * detail +
      Math.sin(t * 71.0 + seed * 7.7) * 0.05 * detail;
    points.push(`${x},${(base - amplitude * (value + 1)).toFixed(1)}`);
  }
  return `M0,${shore} L${points.join(" L")} L${WIDTH},${shore} Z`;
}

const FAR_RIDGE = ridge(1.3, HORIZON_Y + 2, 26, 1, HORIZON_Y + 8);
const NEAR_HILL = ridge(4.2, HORIZON_Y + 7, 12, 0.6, HORIZON_Y + 8);

// Poles stand on the near shore at the right; wires sag between them (a shallow catenary).
// They recede into the distance on the left, so every wire ends on a pole.
const POLES = [
  { x: 880, top: HORIZON_Y - 80, foot: HORIZON_Y + 5 },
  { x: 1030, top: HORIZON_Y - 110, foot: HORIZON_Y + 7 },
  { x: 1180, top: HORIZON_Y - 150, foot: HORIZON_Y + 10 },
  { x: 1375, top: HORIZON_Y - 205, foot: HORIZON_Y + 16 },
  { x: 1560, top: HORIZON_Y - 272, foot: HORIZON_Y + 24 },
];

// Farther poles are shorter, so their cross-arms shrink with them.
function scale(pole: { top: number; foot: number }): number {
  return (pole.foot - pole.top) / (HORIZON_Y + 24 - (HORIZON_Y - 272));
}

function wire(fromX: number, fromY: number, toX: number, toY: number, sag: number): string {
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2 + sag;
  return `M${fromX},${fromY} Q${midX},${midY} ${toX},${toY}`;
}

export default function Horizon() {
  const wires: string[] = [];
  for (let index = 0; index < POLES.length - 1; index += 1) {
    const a = POLES[index];
    const b = POLES[index + 1];
    const sa = scale(a);
    const sb = scale(b);
    for (const drop of [0, 16]) {
      const ya = a.top + (10 + drop) * sa;
      const yb = b.top + (10 + drop) * sb;
      wires.push(wire(a.x - 26 * sa, ya, b.x - 26 * sb, yb, (22 + drop * 0.4) * sb));
      wires.push(wire(a.x + 26 * sa, ya, b.x + 26 * sb, yb, (26 + drop * 0.4) * sb));
    }
  }
  const last = POLES[POLES.length - 1];
  wires.push(wire(last.x + 30, last.top + 10, WIDTH + 40, last.top + 60, 30));
  wires.push(wire(last.x + 30, last.top + 26, WIDTH + 40, last.top + 84, 34));

  return (
    <svg
      className="horizon"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={FAR_RIDGE} fill="#1b2350" />
      <path d={FAR_RIDGE} fill="none" stroke="#f0a47a" strokeOpacity="0.35" strokeWidth="1.2" />
      <path d={NEAR_HILL} fill="#0f1433" />
      {/* The hills' reflection in the still lake. */}
      <g transform={`translate(0 ${2 * (HORIZON_Y + 8)}) scale(1 -1)`} opacity="0.32">
        <path d={FAR_RIDGE} fill="#141b40" />
        <path d={NEAR_HILL} fill="#0b0f2a" />
      </g>
      <g stroke="#0c0b22" strokeLinecap="round">
        {POLES.map((pole) => {
          const k = scale(pole);
          return (
            <g key={pole.x}>
              <line x1={pole.x} y1={pole.top} x2={pole.x} y2={pole.foot} strokeWidth={Math.max(3, 7 * k)} />
              <line x1={pole.x - 34 * k} y1={pole.top + 10 * k} x2={pole.x + 34 * k} y2={pole.top + 10 * k} strokeWidth={Math.max(2.5, 5 * k)} />
              <line x1={pole.x - 28 * k} y1={pole.top + 26 * k} x2={pole.x + 28 * k} y2={pole.top + 26 * k} strokeWidth={Math.max(2, 4 * k)} />
            </g>
          );
        })}
      </g>
      <g fill="none" stroke="#0c0b22" strokeWidth="1.6" vectorEffect="non-scaling-stroke">
        {wires.map((path) => (
          <path key={path} d={path} />
        ))}
      </g>
      <line
        x1="0"
        x2={WIDTH}
        y1={HORIZON_Y + 8}
        y2={HORIZON_Y + 8}
        stroke="#f0a47a"
        strokeOpacity="0.28"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
