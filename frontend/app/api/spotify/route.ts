import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const PREFIX = "apollo_spotify_";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const headers = { "Cache-Control": "no-store" };

function config() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) throw new Error("Spotify connection is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI.");
  const url = new URL(redirectUri);
  if (url.pathname !== "/api/spotify" || url.search || url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("SPOTIFY_REDIRECT_URI must use HTTPS or a loopback IP and end with /api/spotify.");
  }
  return { clientId, redirectUri, origin: url.origin, secure: url.protocol === "https:" };
}

function cookie(response: NextResponse, name: string, value: string, maxAge: number, secure: boolean) {
  response.cookies.set(PREFIX + name, value, { httpOnly: true, sameSite: "lax", secure, path: "/api/spotify", maxAge });
}

function read(request: NextRequest, name: string) {
  return request.cookies.get(PREFIX + name)?.value;
}

function browserOrigin(request: NextRequest) {
  // Next normalizes loopback IPs to localhost in its URL. Preserve the browser's Host.
  const url = new URL(request.url);
  url.host = request.headers.get("host") ?? url.host;
  return url.origin;
}

type Tokens = { access_token: string; refresh_token?: string; expires_in: number };
async function tokens(params: Record<string, string>): Promise<Tokens | null> {
  const response = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params), cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("access_token" in body) || typeof body.access_token !== "string" ||
    !("expires_in" in body) || typeof body.expires_in !== "number" || body.expires_in <= 0) return null;
  return { access_token: body.access_token, expires_in: body.expires_in,
    refresh_token: "refresh_token" in body && typeof body.refresh_token === "string" ? body.refresh_token : undefined };
}

function save(response: NextResponse, token: Tokens, secure: boolean) {
  cookie(response, "access", token.access_token, Math.max(1, token.expires_in - 30), secure);
  if (token.refresh_token) cookie(response, "refresh", token.refresh_token, 60 * 60 * 24 * 30, secure);
}

function popup(origin: string, error?: string) {
  const nonce = randomBytes(16).toString("base64");
  const message = JSON.stringify({ type: "apollo-spotify", error: error ?? null }).replaceAll("<", "\\u003c");
  const target = JSON.stringify(origin).replaceAll("<", "\\u003c");
  return new NextResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect Spotify</title><p id="message"></p><script nonce="${nonce}">const message=${message};document.getElementById('message').textContent=message.error || 'Spotify connected. You can close this window.';if(window.opener){window.opener.postMessage(message,${target});if(!message.error)window.close();}</script></html>`, {
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'` },
  });
}

export async function GET(request: NextRequest) {
  const requestOrigin = browserOrigin(request);
  let origin = requestOrigin;
  try {
    const settings = config();
    origin = settings.origin;
    if (requestOrigin !== origin) return popup(requestOrigin, `Open Apollo at ${origin} to connect Spotify.`);
    if (request.nextUrl.searchParams.get("connect") === "1") {
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(64).toString("base64url");
      const url = new URL("https://accounts.spotify.com/authorize");
      url.search = new URLSearchParams({ client_id: settings.clientId, response_type: "code",
        redirect_uri: settings.redirectUri, scope: "user-modify-playback-state", state,
        code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
      const response = NextResponse.redirect(url);
      response.headers.set("Cache-Control", "no-store");
      cookie(response, "state", state, 600, settings.secure);
      cookie(response, "verifier", verifier, 600, settings.secure);
      return response;
    }
    const state = request.nextUrl.searchParams.get("state");
    const verifier = read(request, "verifier");
    let error: string | undefined;
    let token: Tokens | null = null;
    if (!state || state !== read(request, "state") || !verifier) error = "Spotify connection expired. Close this window and try again.";
    else if (request.nextUrl.searchParams.has("error")) error = "Spotify permission was not granted. Close this window and try again.";
    else {
      const code = request.nextUrl.searchParams.get("code");
      if (code) token = await tokens({ client_id: settings.clientId, grant_type: "authorization_code",
        code, redirect_uri: settings.redirectUri, code_verifier: verifier });
      if (!token) error = "Could not connect Spotify. Close this window and try again.";
    }
    const response = popup(origin, error);
    cookie(response, "state", "", 0, settings.secure);
    cookie(response, "verifier", "", 0, settings.secure);
    if (token) save(response, token, settings.secure);
    return response;
  } catch (error) {
    return popup(origin, error instanceof Error && error.message.startsWith("Spotify connection is not configured") ? error.message : "Could not connect Spotify. Check its configuration and try again.");
  }
}

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(request: NextRequest) {
  // Playback changes require a same-origin browser request, even with an existing session.
  const requestOrigin = browserOrigin(request);
  if (request.headers.get("origin") !== requestOrigin) return failure("Invalid request origin.", 403);
  try {
    const settings = config();
    if (requestOrigin !== settings.origin) return failure(`Open Apollo at ${settings.origin} to use Spotify.`, 400);
    let body: unknown;
    try { body = await request.json(); } catch { return failure("Invalid playback request.", 400); }
    if (!body || typeof body !== "object" || !("spotifyUrl" in body) || typeof body.spotifyUrl !== "string" ||
      !("seconds" in body) || typeof body.seconds !== "number" || !Number.isFinite(body.seconds) || body.seconds < 0 || body.seconds > 86400) {
      return failure("Invalid track or timestamp.", 400);
    }
    let track: string | undefined;
    try {
      const url = new URL(body.spotifyUrl);
      if (url.protocol === "https:" && ["open.spotify.com", "www.spotify.com"].includes(url.hostname)) {
        track = url.pathname.match(/^\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})\/?$/)?.[1];
      }
    } catch { /* Invalid links are rejected below. */ }
    if (!track) return failure("This catalog entry needs a Spotify track link.", 400);
    const positionMs = Math.round(body.seconds * 1000);
    let access = read(request, "access");
    const refresh = read(request, "refresh");
    let renewed: Tokens | null = null;
    if (!access && refresh) {
      renewed = await tokens({ client_id: settings.clientId, grant_type: "refresh_token", refresh_token: refresh });
      access = renewed?.access_token;
    }
    if (!access) return failure("Connect Spotify to play at the detected time.", 401);
    const play = (token: string) => fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [`spotify:track:${track}`], position_ms: positionMs }),
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    let result = await play(access);
    if (result.status === 401 && refresh) {
      renewed = await tokens({ client_id: settings.clientId, grant_type: "refresh_token", refresh_token: refresh });
      if (renewed) result = await play(renewed.access_token);
    }
    let response: NextResponse;
    if (result.ok) response = NextResponse.json({ played: true }, { headers });
    else if (result.status === 401) {
      response = failure("Reconnect Spotify to continue.", 401);
      cookie(response, "access", "", 0, settings.secure);
      cookie(response, "refresh", "", 0, settings.secure);
    } else if (result.status === 404) response = failure("Open Spotify and play any song on your device, then try this button again.", 404);
    else if (result.status === 403) response = failure("Spotify denied playback. Check that your connected account has Premium and is allowed in the developer app.", 403);
    else if (result.status === 429) response = failure("Spotify is busy. Wait a moment and try again.", 429);
    else response = failure("Spotify could not start this track. Try again.", 502);
    if (renewed && result.status !== 401) save(response, renewed, settings.secure);
    return response;
  } catch (error) {
    return failure(error instanceof Error && error.message.startsWith("Spotify connection is not configured") ? error.message : "Could not reach Spotify. Check its configuration or try again.", 503);
  }
}
