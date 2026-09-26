import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const origin = "http://127.0.0.1:3000";
const track = "4iV5W9uYEdYUVa79Axb7Rh";
const source = readFileSync(new URL("../app/api/spotify/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function load(fetch, env = { SPOTIFY_CLIENT_ID: "test-client", SPOTIFY_REDIRECT_URI: `${origin}/api/spotify` }) {
  const exports = {};
  runInNewContext(compiled, { exports, require, process: { env }, fetch, URL, URLSearchParams, AbortSignal });
  return exports;
}

function request(body = { spotifyUrl: `https://open.spotify.com/track/${track}`, seconds: 83.4 }, cookie = "apollo_spotify_access=test-access", requestOrigin = origin) {
  return new NextRequest(`${origin}/api/spotify`, { method: "POST",
    headers: { host: "127.0.0.1:3000", origin: requestOrigin, cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("playback sends the matched track and millisecond position in one request", async () => {
  const calls = [];
  const api = load(async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 204 }); });
  const response = await api.POST(request());
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.spotify.com/v1/me/player/play");
  assert.deepEqual(JSON.parse(calls[0].options.body), { uris: [`spotify:track:${track}`], position_ms: 83400 });
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-access");
});

test("cross-origin, invalid timestamps and non-track links never call Spotify", async () => {
  const api = load(() => { throw new Error("Unexpected network request"); });
  assert.equal((await api.POST(request(undefined, undefined, "https://elsewhere.example"))).status, 403);
  for (const seconds of [-1, "83", null, 86401]) {
    assert.equal((await api.POST(request({ spotifyUrl: `https://open.spotify.com/track/${track}`, seconds }))).status, 400);
  }
  assert.equal((await api.POST(request({ spotifyUrl: "https://evil.example/track/" + track, seconds: 0 }))).status, 400);
});

test("missing authorization asks for a connection without network work", async () => {
  const api = load(() => { throw new Error("Unexpected network request"); });
  assert.equal((await api.POST(request(undefined, ""))).status, 401);
});

test("an expired access cookie refreshes only on a playback request", async () => {
  const calls = [];
  const api = load(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json({ access_token: "renewed", expires_in: 3600, refresh_token: "next-refresh" }) : new Response(null, { status: 204 });
  });
  const response = await api.POST(request(undefined, "apollo_spotify_refresh=refresh"));
  assert.equal(response.status, 200);
  assert.equal(new URLSearchParams(calls[0].options.body).get("grant_type"), "refresh_token");
  assert.equal(calls[1].options.headers.Authorization, "Bearer renewed");
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /apollo_spotify_refresh=next-refresh/);
});

test("a revoked access token is refreshed and retried once", async () => {
  let calls = 0;
  const api = load(async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 401 });
    if (calls === 2) return Response.json({ access_token: "renewed", expires_in: 3600 });
    return new Response(null, { status: 204 });
  });
  assert.equal((await api.POST(request(undefined, "apollo_spotify_access=old; apollo_spotify_refresh=refresh"))).status, 200);
  assert.equal(calls, 3);
});

test("Spotify device, Premium and rate-limit failures give actionable errors", async () => {
  for (const [status, pattern] of [[404, /Open Spotify/], [403, /Premium/], [429, /Wait a moment/]]) {
    const api = load(async () => new Response(null, { status }));
    const response = await api.POST(request());
    assert.equal(response.status, status);
    assert.match((await response.json()).error, pattern);
  }
});

test("connection uses PKCE, a random state and only playback permission", async () => {
  const api = load(() => { throw new Error("Unexpected network request"); });
  const response = await api.GET(new NextRequest(`${origin}/api/spotify?connect=1`, { headers: { host: "127.0.0.1:3000" } }));
  const url = new URL(response.headers.get("location"));
  assert.equal(url.origin, "https://accounts.spotify.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "user-modify-playback-state");
  assert.equal(url.searchParams.get("redirect_uri"), `${origin}/api/spotify`);
  assert.ok(url.searchParams.get("state"));
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
});

test("callbacks reject mismatched state and do not exchange an authorization code", async () => {
  const api = load(() => { throw new Error("Unexpected network request"); });
  const response = await api.GET(new NextRequest(`${origin}/api/spotify?state=wrong&code=code`, {
    headers: { host: "127.0.0.1:3000", cookie: "apollo_spotify_state=expected; apollo_spotify_verifier=verifier" },
  }));
  assert.match(await response.text(), /connection expired/);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("successful callback stores tokens in HttpOnly cookies and signals only connection status", async () => {
  const api = load(async () => Response.json({ access_token: "secret-access", refresh_token: "secret-refresh", expires_in: 3600 }));
  const response = await api.GET(new NextRequest(`${origin}/api/spotify?state=expected&code=code`, {
    headers: { host: "127.0.0.1:3000", cookie: "apollo_spotify_state=expected; apollo_spotify_verifier=verifier" },
  }));
  const html = await response.text();
  assert.match(html, /postMessage/);
  assert.doesNotMatch(html, /secret-access|secret-refresh/);
  assert.match(response.headers.get("set-cookie"), /apollo_spotify_access=secret-access/);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
});
