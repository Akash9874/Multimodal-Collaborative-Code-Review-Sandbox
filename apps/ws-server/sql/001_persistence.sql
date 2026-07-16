-- Phase 4a persistence. A PRIVATE schema, never granted to anon/authenticated, so Supabase's
-- REST Data API cannot reach it. The ws-server reaches it via its direct Postgres connection.
create schema if not exists sandbox;

create table if not exists sandbox.rooms (
  id          text        primary key,
  ydoc_state  bytea       not null,        -- Y.encodeStateAsUpdate(doc)
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- The TTL sweep and the staleness tests both order by this.
create index if not exists rooms_updated_at_idx on sandbox.rooms (updated_at);

-- Defense in depth: even if the schema were ever exposed, no policy means the Data API sees nothing.
alter table sandbox.rooms enable row level security;
