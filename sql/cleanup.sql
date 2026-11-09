-- Removes exactly the rows seed.sql wrote (created_by = 'stress'). Same database-name guard as seed.sql.
--
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f sql/cleanup.sql

select current_database() ~ '(stress|loadtest)' as name_ok \gset
\if :name_ok
\else
  \echo 'REFUSED: database name must contain "stress" or "loadtest". Nothing was deleted.'
  \quit
\endif

begin;
delete from pass_user where created_by = 'stress';
delete from event_seat_count where event_id in (select id from event where created_by = 'stress');  -- no foreign key to event
delete from event where created_by = 'stress';      -- user_event rows go with their event (ON DELETE CASCADE)
delete from "user" where created_by = 'stress';     -- remaining user_event rows go with their user
commit;

\echo 'Remaining rows with created_by = stress:'
select (select count(*) from "user" where created_by = 'stress') as users,
       (select count(*) from event where created_by = 'stress') as events,
       (select count(*) from user_event where created_by = 'stress') as user_event_rows,
       (select count(*) from event_seat_count c where not exists (select 1 from event e where e.id = c.event_id)) as orphan_seat_counters,
       (select count(*) from pass_user where created_by = 'stress') as pass_user_rows;
