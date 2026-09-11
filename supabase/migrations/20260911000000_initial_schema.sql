create table public.songs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  spotify_url text not null unique check (btrim(spotify_url) <> '')
);

create table public.acoustic_fingerprints (
  song_id uuid not null references public.songs(id) on delete cascade,
  fingerprint_version text not null,
  hash_value text not null check (hash_value ~ '^[0-9a-f]{16}$'),
  anchor_frame integer not null check (anchor_frame >= 0),
  primary key (song_id, fingerprint_version, hash_value, anchor_frame)
);

create index acoustic_fingerprint_lookup
  on public.acoustic_fingerprints (fingerprint_version, hash_value);

alter table public.songs enable row level security;
alter table public.acoustic_fingerprints enable row level security;

revoke all on table public.songs from anon, authenticated;
revoke all on table public.acoustic_fingerprints from anon, authenticated;

grant all on table public.songs to service_role;
grant all on table public.acoustic_fingerprints to service_role;
