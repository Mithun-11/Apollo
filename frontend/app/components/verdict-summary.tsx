import type { RecognitionExplanationResponse } from "../../lib/api";

export default function VerdictSummary({ response }: { response: RecognitionExplanationResponse }) {
  const { recognition, explanation } = response;
  const { decision, counts } = explanation;
  const speed = recognition.speedFactor ?? 1;
  const pitch = recognition.pitchFactor ?? 1;
  const title = decision.reason === "accepted" ? `${recognition.song?.name ?? "This song"} passed both matching rules.` : decision.reason === "ambiguous" ? "The leading song was too close to another candidate." : decision.reason === "below_threshold" ? "A candidate appeared, but too few fingerprints agreed." : "Apollo could not confirm a song from this recording.";
  const maximum = Math.max(decision.minimumVotes, decision.leadingVotes, decision.runnerUpVotes, 1);
  const rules = [
    { label: `At least ${decision.minimumVotes} aligned votes`, passes: decision.leadingVotes >= decision.minimumVotes, detail: `${decision.leadingVotes} votes` },
    { label: `${decision.minimumWinnerRatio}× the best other song`, passes: decision.leadingVotes > 0 && decision.leadingVotes >= decision.runnerUpVotes * decision.minimumWinnerRatio, detail: `${decision.leadingVotes} vs ${decision.runnerUpVotes}` },
    { label: "Nonnegative source offset", passes: decision.leadingOffsetSeconds !== null, detail: decision.leadingOffsetSeconds === null ? "No valid offset" : `${decision.leadingOffsetSeconds.toFixed(2)} s` },
  ];
  return (
    <section className="verdict-summary" aria-labelledby="verdict-title">
      <p className="result-label">Why this result</p>
      <h3 id="verdict-title">{title}</h3>
      <p>{counts.matchingHashes} distinct query hashes were found in the catalog. {counts.lookupFingerprints} fingerprints were checked for the displayed lookup. {decision.leadingVotes > 0 ? `${decision.leadingVotes} aligned votes supported the leading song.` : "No aligned votes supported a song."}</p>
      {recognition.matched && (Math.abs(speed - 1) >= .02 || Math.abs(pitch - 1) >= .02) && <p>{Math.abs(speed - 1) >= .02 ? `The recording played at ${speed.toFixed(2)}× speed. ` : `Its pitch shifted by ${(12 * Math.log2(pitch)).toFixed(1)} semitones. `}Apollo mapped its detected peaks to the song&apos;s grid for the successful lookup.</p>}
      <div className="verdict-bars" aria-label="Leading and competing song vote comparison">
        <div><span>Leading song · {decision.leadingVotes}</span><i style={{ width: `${decision.leadingVotes / maximum * 100}%` }} /></div>
        <div><span>Best other song · {decision.runnerUpVotes}</span><i style={{ width: `${decision.runnerUpVotes / maximum * 100}%` }} /></div>
        <div><span>Required votes · {decision.minimumVotes}</span><i style={{ width: `${decision.minimumVotes / maximum * 100}%` }} /></div>
      </div>
      <ul className="verdict-rules">{rules.map((rule) => <li key={rule.label}><span aria-label={rule.passes ? "Pass" : "Not passed"}>{rule.passes ? "✓" : "×"}</span><strong>{rule.label}</strong><small>{rule.detail}</small></li>)}</ul>
      {recognition.matched ? <div className="verdict-evidence-gauge"><p>Matched-vote share of query fingerprints: {Math.round(recognition.confidence * 100)}%</p><i><b style={{ width: `${Math.min(100, Math.max(0, recognition.confidence * 100))}%` }} /></i><small>This is an evidence ratio, not a probability that the answer is correct.</small></div> : null}
    </section>
  );
}
