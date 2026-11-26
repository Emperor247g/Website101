-- Crown & Oak — Supabase Realtime setup
--
-- Optional troubleshooting for projects with Realtime authorization enabled.
-- The game normally uses public Realtime channels named crown-oak-<ROOM_CODE>.
-- If your project has "Allow public access" disabled or custom RLS policies,
-- run this in the SQL Editor so anon/authenticated clients can exchange
-- Broadcast and Presence messages.

-- Allow players to receive Broadcast and Presence messages.
drop policy if exists "crown oak realtime receive" on "realtime"."messages";
create policy "crown oak realtime receive"
on "realtime"."messages"
for select
to anon, authenticated
using (true);

-- Allow players to send Broadcast messages and publish Presence.
drop policy if exists "crown oak realtime send" on "realtime"."messages";
create policy "crown oak realtime send"
on "realtime"."messages"
for insert
to anon, authenticated
with check (true);

-- Presence state can also be updated/removed as clients come and go.
drop policy if exists "crown oak realtime update" on "realtime"."messages";
create policy "crown oak realtime update"
on "realtime"."messages"
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "crown oak realtime delete" on "realtime"."messages";
create policy "crown oak realtime delete"
on "realtime"."messages"
for delete
to anon, authenticated
using (true);
