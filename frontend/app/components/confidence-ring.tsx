export default function ConfidenceRing({ elapsed, max, confirmation }: { elapsed: number; max: number; confirmation: 0 | 50 | 100 }) {
  const progress = Math.min(100, elapsed / max * 100);
  return (
    <div className="confirmation-ring" role="img" aria-label={`Recording ${Math.round(progress)} percent of time limit. Recognition confirmation ${confirmation} percent.`} style={{ background: `conic-gradient(#efbd78 ${confirmation}%, #28444c 0)` }}>
      <div className="confirmation-ring-inner" style={{ background: `conic-gradient(#94dddc ${progress}%, #203840 0)` }}>
        <div><strong>{confirmation === 100 ? "✓" : `${elapsed}s`}</strong><span>{confirmation === 100 ? "Confirmed" : confirmation === 50 ? "Possible" : "Listening"}</span></div>
      </div>
    </div>
  );
}
