-- Seeds a SEPARATE test database for the KUYY stress tests. Never run it against dev, beta or prod.
--
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f sql/seed.sql [-v users=20000 ...]
--
-- Safety: the script stops unless the database name contains "stress" or "loadtest".
-- Every row it writes has created_by = 'stress', so cleanup.sql can remove exactly these rows.
-- The schema must be migrated first (all of db/migrations).

select current_database() ~ '(stress|loadtest)' as name_ok \gset
\if :name_ok
\else
  \echo 'REFUSED: database name must contain "stress" or "loadtest". Nothing was written.'
  \quit
\endif

\if :{?users}
\else
  \set users 3000
\endif
\if :{?hosts}
\else
  \set hosts 20
\endif
\if :{?events}
\else
  \set events 400
\endif
\if :{?fill}
\else
  \set fill 15
\endif
\if :{?hot_guests}
\else
  \set hot_guests 2500
\endif
\if :{?hot_extra}
\else
  \set hot_extra 10
\endif
\if :{?hot_extra_guests}
\else
  \set hot_extra_guests 500
\endif
\if :{?control}
\else
  \set control 10
\endif
\if :{?race}
\else
  \set race 20
\endif
\if :{?pass_holders}
\else
  \set pass_holders 1000
\endif

\echo Seeding with users=:users hosts=:hosts events=:events fill=:fill hot_guests=:hot_guests

select (:hot_guests < :users) and (:hot_extra_guests < :users) and (:pass_holders < :users) as scale_ok \gset
\if :scale_ok
\else
  \echo 'REFUSED: hot_guests, hot_extra_guests and pass_holders must each be smaller than users.'
  \quit
\endif

begin;

-- Users. User 1 is the pass-holder host. Every 20th user has no username (KUYY-70 regression data).
create temp table su (n int primary key, id uuid not null) on commit drop;
insert into su select n, uuid_generate_v4() from generate_series(1, :users) n;

insert into "user" (id, name, phone, birthdate, gender, image_url, role,
                    account_verified, phone_verified, email_verified,
                    created_by, updated_by, email, username)
select su.id,
       case when su.n = 1 then 'STRESS PASSHOST' else 'STRESS U' || su.n end,
       '0812' || lpad(su.n::text, 8, '0'),
       date '1990-01-01', 'male', '', 'USER',
       true, true, true,
       'stress', 'stress',
       'stress.u' || su.n || '@stress.invalid',
       case when su.n % 20 = 0 then null else 'stressu' || su.n end
from su;

-- Event plan: one row per event, with its kind, capacity and number of guests.
create temp table se (r int primary key, id uuid not null, kind text, k int, name text, lim int, guests int, host_n int) on commit drop;
insert into se
select row_number() over (order by kind, k), uuid_generate_v4(), kind, k, name, lim, guests,
       (k % :hosts) + 1
from (
  select 'fill' as kind, n as k, 'STRESS EVENT ' || n as name, 30 as lim, :fill as guests from generate_series(1, :events) n
  union all select 'hot', 1, 'STRESS HOT 1', :hot_guests + 50, :hot_guests
  union all select 'hot', 1 + n, 'STRESS HOT ' || (1 + n), :hot_extra_guests + 50, :hot_extra_guests from generate_series(1, :hot_extra) n
  union all select 'control', n, 'STRESS CONTROL ' || n, 30, 10 from generate_series(1, :control) n
  union all select 'race', n, 'STRESS RACE ' || n, 50, 0 from generate_series(1, :race) n
  union all select 'open', 1, 'STRESS OPEN 1', 200, 0
) plan;

insert into event (id, name, description, category, categories, "limit", start_timestamp, end_timestamp,
                   image_url, location, latitude, longitude, code, status, type, price, timezone,
                   host_id, created_by, updated_by)
select se.id, se.name, 'Stress test activity. Safe to delete.', 'fitness', array['fitness'], se.lim,
       date_trunc('day', now()) + ((se.r % 60) + 1) * interval '1 day' + interval '2 hours',
       date_trunc('day', now()) + ((se.r % 60) + 1) * interval '1 day' + interval '3 hours',
       '', 'Stress Studio', -6.2 + (se.r % 50) * 0.001, 106.8 + (se.r % 50) * 0.001,
       'S' || substr(md5(se.id::text), 1, 7), 'scheduled', 'public', 0, 'Asia/Jakarta',
       h.id, 'stress', 'stress'
from se
join su h on h.n = se.host_n;

-- Host seat for every event, as a real activity has.
insert into user_event (user_id, event_id, role, is_favorite, status, created_by, updated_by, created_at)
select h.id, se.id, 'host', false, 'going', 'stress', 'stress', now() - interval '95 days'
from se
join su h on h.n = se.host_n;

-- Guests. Ordinary events get old join times. The hot events get recent ones, so the hot
-- event's first three guests sit far from the start of ix_user_event_created_at (KUYY H2).
insert into user_event (user_id, event_id, role, is_favorite, status, created_by, updated_by, created_at)
select g.id, se.id, 'guest', false, 'going', 'stress', 'stress',
       case when se.kind in ('hot', 'open')
            then now() - interval '2 days' + (gs.g * interval '1 second')
            else now() - interval '3 days' - random() * interval '87 days' end
from se
cross join lateral generate_series(1, se.guests) as gs(g)
join su g on g.n = ((se.r * 131 + gs.g) % :users) + 1
where g.n <> se.host_n;

-- Seat counters. Reads of seats come from event_seat_count (migration 244), which the application keeps
-- after each write to user_event. A bulk load bypasses it, so this is the backfill statement of that migration.
insert into event_seat_count (event_id, member_rows, member_seats, occupied_seats, waiting_seats)
select ue.event_id,
       count(*) filter (where ue.role not in ('removed', '') and ue.status not in ('rejected', 'waiting')),
       coalesce(sum(ue.quantity) filter (where ue.role not in ('removed', '') and ue.status not in ('rejected', 'waiting')), 0),
       coalesce(sum(ue.quantity) filter (where ue.status in ('going', 'checkedin', 'pending')), 0),
       coalesce(sum(ue.quantity) filter (where ue.role not in ('removed', '') and ue.status = 'waiting'), 0)
from user_event ue
where ue.event_id in (select id from se)
group by ue.event_id
on conflict (event_id) do update
    set member_rows = excluded.member_rows, member_seats = excluded.member_seats,
        occupied_seats = excluded.occupied_seats, waiting_seats = excluded.waiting_seats;

-- Pass holders for the pass-holder host (user 1). Some holders have no username.
-- pass_user.host_id is generated from metadata.usage_restriction.host_id, so it is set through metadata.
insert into pass_user (user_id, nominal_value, pass_type, discount_type, source_type, source_id, status,
                       used_transaction_id, created_by, updated_by, expired_at, metadata)
select su.id, 100000, 'credit_pass', 'flat', 'package', 'STRESS-PKG-' || (su.n % 5),
       case when su.n % 10 = 0 then 'expired' else 'active' end,
       '', 'stress', 'stress',
       case when su.n % 10 = 0 then now() - interval '5 days' else now() + interval '30 days' end,
       jsonb_build_object('title', 'STRESS Pass ' || (su.n % 5),
                          'usage_restriction', jsonb_build_object('host_id', (select id from su where n = 1)))
from su
where su.n between 2 and :pass_holders + 1;

commit;

analyze "user";
analyze event;
analyze user_event;
analyze pass_user;

\echo 'Seed summary'
select (select count(*) from "user" where created_by = 'stress') as users,
       (select count(*) from "user" where created_by = 'stress' and username is null) as users_without_username,
       (select count(*) from event where created_by = 'stress') as events,
       (select count(*) from user_event where created_by = 'stress') as user_event_rows,
       (select count(*) from pass_user where created_by = 'stress') as pass_user_rows;
