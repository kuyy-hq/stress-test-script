-- Hard invariants for the stress tests (read-only). Every section must return zero rows
-- unless its heading says it is informational. Run after each write scenario (B1, B2, I2).
--
-- The seat count here ignores held additions and external seats. Both are zero in the seeded data.

\echo '== 1. Oversold events (seats > limit). Must be empty.'
select e.name, e."limit", s.seats
from event e
join lateral (
  select coalesce(sum(ue.quantity), 0) as seats
  from user_event ue
  where ue.event_id = e.id
    and ue.role not in ('removed', '')
    and ue.status not in ('rejected', 'waiting')
) s on true
where e.created_by = 'stress'
  and s.seats > e."limit";

\echo '== 1b. Seat counter drift: event_seat_count differs from the real sum in user_event. Must be empty.'
\echo '   (The application keeps the counter after each write. A difference after a concurrent run is a bug.)'
select e.name, c.member_seats as counter, a.seats as actual
from event e
join event_seat_count c on c.event_id = e.id
join lateral (
  select coalesce(sum(ue.quantity) filter (where ue.role not in ('removed', '') and ue.status not in ('rejected', 'waiting')), 0) as seats
  from user_event ue where ue.event_id = e.id
) a on true
where e.created_by = 'stress'
  and c.member_seats <> a.seats;

\echo '== 2. Users with more than one active seat on the same event (informational: quantity may legitimately differ).'
select e.name, ue.user_id, count(*) as rows, sum(ue.quantity) as seats
from user_event ue
join event e on e.id = ue.event_id
where e.created_by = 'stress'
  and ue.role = 'guest'
  and ue.status not in ('rejected', 'waiting')
group by e.name, ue.user_id
having count(*) > 1
limit 50;

\echo '== 3. Fill level of the race and open events (informational).'
select e.name, e."limit",
       coalesce(sum(ue.quantity) filter (where ue.role not in ('removed', '') and ue.status not in ('rejected', 'waiting')), 0) as seats
from event e
left join user_event ue on ue.event_id = e.id
where e.name like 'STRESS RACE %' or e.name = 'STRESS OPEN 1'
group by e.name, e."limit"
order by e.name;
