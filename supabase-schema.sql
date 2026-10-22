-- Run this in Supabase Dashboard > SQL Editor.
create table if not exists public.voice_sales_calls (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.voice_sales_calls enable row level security;
-- No client-side policies are added. The backend uses the service-role key,
-- which must never be exposed to the browser.
