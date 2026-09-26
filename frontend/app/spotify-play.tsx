"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "./replay/data";

type SpotifyPlayProps = { spotifyUrl: string; seconds: number | null };

export default function SpotifyPlay({ spotifyUrl, seconds }: SpotifyPlayProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  async function play(): Promise<boolean> {
    const response = await fetch("/api/spotify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotifyUrl, seconds: Math.max(0, seconds ?? 0) }),
      signal: AbortSignal.timeout(30_000),
    });
    const body: { error?: string } = await response.json();
    if (response.status === 401) return false;
    if (!response.ok) throw new Error(body.error ?? "Spotify could not start playback.");
    setMessage(`Playing on Spotify at ${formatClock(seconds ?? 0)}.`);
    return true;
  }

  async function start() {
    // Open synchronously with the click so browser popup blocking does not lose the song result.
    const popup = window.open("about:blank", "apollo-spotify", "popup,width=500,height=720");
    if (!popup) {
      setMessage("Allow popups for Apollo to connect Spotify, then try again.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (await play()) { popup.close(); setBusy(false); return; }
      setMessage("Connect Spotify in the opened window.");
      const finish = () => {
        window.removeEventListener("message", receive);
        window.clearInterval(timer);
        cleanup.current = null;
      };
      const receive = async (event: MessageEvent<unknown>) => {
        if (event.origin !== window.location.origin || event.source !== popup || !event.data ||
          typeof event.data !== "object" || !("type" in event.data) || event.data.type !== "apollo-spotify") return;
        finish();
        popup.close();
        try {
          if ("error" in event.data && typeof event.data.error === "string") throw new Error(event.data.error);
          if (!await play()) throw new Error("Spotify connection expired. Try again.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not start Spotify playback.");
        } finally { setBusy(false); }
      };
      // This timer exists only while the user-requested connection window is open.
      const timer = window.setInterval(() => {
        if (popup.closed) { finish(); setBusy(false); setMessage("Spotify connection closed. Try again when ready."); }
      }, 500);
      cleanup.current = () => { finish(); popup.close(); };
      window.addEventListener("message", receive);
      popup.location.href = "/api/spotify?connect=1";
    } catch (error) {
      popup.close();
      setMessage(error instanceof Error ? error.message : "Could not reach Spotify. Try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="action" onClick={start} disabled={busy}>
        {busy ? "Connecting to Spotify…" : `Play on Spotify at ${formatClock(seconds ?? 0)}`}
      </button>
      {message ? <p className="title-card-detail" role="status">{message}</p> : null}
    </div>
  );
}
