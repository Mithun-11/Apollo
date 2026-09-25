import { Fragment } from "react";

export type CheckEvent = {
  seconds: number;
  status: "none" | "possible" | "confirmed";
  songName: string | null;
};

export default function CheckTimeline({ checks, duration }: { checks: CheckEvent[]; duration: number }) {
  return (
    <div className="check-timeline" aria-live="polite" aria-label="Recognition checks over recording time">
      <div className="check-timeline-track">
        {checks.map((check, index) => {
          const label = `${check.seconds.toFixed(1)} s — ${check.status === "none" ? "No match" : check.status === "confirmed" ? "Confirmed" : "Possible match"}${check.songName ? `: ${check.songName}` : ""}`;
          const previous = checks[index - 1];
          return (
            <Fragment key={`${check.seconds}-${index}`}>
            {check.status === "confirmed" && previous?.status === "confirmed" && <i className="check-confirmed-line" style={{ left: `${previous.seconds / duration * 100}%`, width: `${(check.seconds - previous.seconds) / duration * 100}%` }} aria-hidden="true" />}
            <span className={`check-dot check-dot--${check.status}`} style={{ left: `${Math.min(100, check.seconds / duration * 100)}%` }} tabIndex={0} title={label} data-label={label} aria-label={label}>
              {check.status === "confirmed" && previous?.status === "confirmed" ? <span className="check-confirmed-label">✓ Confirmed</span> : null}
            </span>
            </Fragment>
          );
        })}
      </div>
      <div className="check-timeline-axis"><span>0 s</span><span>{duration} s</span></div>
    </div>
  );
}
