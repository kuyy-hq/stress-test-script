-- Read-only checks to run while a scenario is running, or right after it. Safe on any Postgres 13+.
-- Run repeatedly with: watch -n 5 "psql \"$TEST_DB_URL\" -f sql/monitor.sql"

\echo '== Connections by state (a pool of 10 per replica shows up as a ceiling here)'
select state, wait_event_type, wait_event, count(*)
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid()
group by 1, 2, 3
order by 4 desc;

\echo '== Sessions waiting on an advisory lock (joins queued behind one hot event)'
select count(*) as waiting_on_advisory_lock
from pg_stat_activity
where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory';

\echo '== Longest running queries'
select pid, now() - query_start as running, state, left(query, 100) as query
from pg_stat_activity
where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid()
order by query_start
limit 5;

\echo '== Dead tuples and autovacuum on the busiest tables'
select relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
from pg_stat_user_tables
where relname in ('user_event', 'event', 'pass_user', 'transactions', 'user')
order by relname;

select count(*) > 0 as has_statements from pg_extension where extname = 'pg_stat_statements' \gset
\if :has_statements
  \echo '== Top statements by total time (pg_stat_statements; reset it before a run with: select pg_stat_statements_reset();)'
  select calls, round(total_exec_time) as total_ms, round(mean_exec_time::numeric, 1) as mean_ms, rows, left(query, 110) as query
  from pg_stat_statements
  order by total_exec_time desc
  limit 10;
\else
  \echo '(pg_stat_statements is not installed here: create extension pg_stat_statements; and add it to shared_preload_libraries)'
\endif
