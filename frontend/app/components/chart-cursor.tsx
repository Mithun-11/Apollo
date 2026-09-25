"use client";

import { useRef, useState, type ReactNode } from "react";

type Point = { x: number; y: number; label: string };

export default function ChartCursor({ children, describe, onHover }: { children: ReactNode; describe: (x: number, y: number) => string; onHover?: (x: number | null, y: number | null) => void }) {
  const [point, setPoint] = useState<Point | null>(null);
  const lastUpdate = useRef(0);
  return (
    <div className="chart-cursor" onPointerMove={(event) => {
      if (event.pointerType === "touch") return;
      if (performance.now() - lastUpdate.current < 1000 / 30) return;
      lastUpdate.current = performance.now();
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      setPoint({ x, y, label: describe(x, y) });
      onHover?.(x, y);
    }} onPointerLeave={() => { setPoint(null); onHover?.(null, null); }}>
      {children}
      {point && <div className="chart-crosshair" aria-hidden="true"><i className="chart-crosshair-x" style={{ left: `${point.x * 100}%` }} /><i className="chart-crosshair-y" style={{ top: `${point.y * 100}%` }} /><span className="chart-crosshair-tip" style={{ left: `${Math.min(70, point.x * 100 + 2)}%`, top: `${Math.max(4, point.y * 100 - 13)}%` }}>{point.label}</span></div>}
    </div>
  );
}
