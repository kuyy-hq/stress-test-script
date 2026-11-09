-- One round of updates that leaves dead tuples behind, like the production table had (about 200k).
-- The Makefile target "churn" runs it ROUNDS times. Same database-name guard as seed.sql.

select current_database() ~ '(stress|loadtest)' as name_ok \gset
\if :name_ok
\else
  \echo 'REFUSED: database name must contain "stress" or "loadtest".'
  \quit
\endif

update user_event ue
set updated_at = now()
from event e
where e.id = ue.event_id and e.created_by = 'stress';

select relname, n_live_tup, n_dead_tup from pg_stat_user_tables where relname = 'user_event';
