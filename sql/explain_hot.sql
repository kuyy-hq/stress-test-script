-- Query plans for the suspected slow reads (H1, H2 of the plan). Read-only, but EXPLAIN ANALYZE runs the query.
-- Run before and after ANALYZE, and before and after adding an index, and compare:
--   psql "$TEST_DB_URL" -f sql/explain_hot.sql

\echo '== H2: first three guests of the hot event (GetEvent in domain/events/entity/event/repository/postgres.go)'
explain (analyze, buffers)
select ue.*
from user_event ue
where ue.event_id = (select id from event where name = 'STRESS HOT 1')
  and ue.role <> 'removed' and ue.role <> ''
  and ue.status <> 'rejected' and ue.status <> 'waiting'
order by ue.created_at asc
limit 3;

\echo '== H1: seats taken by the hot event (GetEventMembersCount)'
explain (analyze, buffers)
select coalesce(sum(ue.quantity), 0)
from user_event ue
where ue.event_id = (select id from event where name = 'STRESS HOT 1')
  and ue.role <> 'removed' and ue.role <> ''
  and ue.status <> 'rejected' and ue.status <> 'waiting';

\echo '== The same count for a control event with 10 guests, as the baseline'
explain (analyze, buffers)
select coalesce(sum(ue.quantity), 0)
from user_event ue
where ue.event_id = (select id from event where name = 'STRESS CONTROL 1')
  and ue.role <> 'removed' and ue.role <> ''
  and ue.status <> 'rejected' and ue.status <> 'waiting';
